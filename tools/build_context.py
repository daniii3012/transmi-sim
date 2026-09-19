"""Offline OSM context. Preserve actual polygons and explicit bridge/tunnel tags."""
import hashlib,json
from pathlib import Path
from shapely.geometry import LineString,Polygon
from shapely.ops import transform
from geo import PROJECT
ROOT=Path(__file__).resolve().parents[1]
def build():
 p=ROOT/'data/raw/context/20260910/osm_overpass_raw.json';raw=json.loads(p.read_text());features=[]
 for e in raw['elements']:
  if e.get('type')!='way' or len(e.get('geometry',[]))<2:continue
  tags=e.get('tags',{});points=[PROJECT.transform(g['lon'],g['lat']) for g in e['geometry']]
  closed=points[0]==points[-1] and len(points)>=4
  kind='road' if 'highway'in tags else 'park' if tags.get('leisure')=='park' else 'water'
  if closed and kind!='road':
   geom=Polygon(points)
   if not geom.is_valid:geom=geom.buffer(0)
   if geom.is_empty or geom.geom_type!='Polygon':continue
   geom=geom.simplify(10,preserve_topology=True);points=list(geom.exterior.coords)
   holes=[[[round(x,1),round(y,1)] for x,y in r.coords] for r in geom.interiors]
  else:points=list(LineString(points).simplify(10).coords);holes=[]
  features.append({'id':e['id'],'kind':kind,'name':tags.get('name',''),'points':[[round(x,1),round(y,1)] for x,y in points],
    'holes':holes,'closed':closed,'bridge':tags.get('bridge') not in (None,'no'),'tunnel':tags.get('tunnel') not in (None,'no'),
    'layer':tags.get('layer'),'junction':tags.get('junction')})
 return {'source':'https://overpass-api.de/api/interpreter','attribution':'© OpenStreetMap contributors, ODbL 1.0','license_url':'https://www.openstreetmap.org/copyright',
    'retrieved_at':'2026-09-10T19:56:43Z','source_sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'features':features}
if __name__=='__main__':
 d=build();(ROOT/'app/dist/context.json').write_text(json.dumps(d,ensure_ascii=False,separators=(',',':'))+'\n');print('Context features',len(d['features']))
