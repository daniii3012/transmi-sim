"""Build reproducible metric services from immutable official snapshots.

Route linear references disambiguate loops; only a nearby published stop may
correct a reference. Missing geometry is never synthesized. All heuristics and
source hashes accompany the output, separately from official attributes.
"""
import hashlib
import json
import math
import unicodedata
from collections import Counter
from pathlib import Path
from shapely.geometry import LineString, Point, shape
from shapely.ops import transform, substring, unary_union
from geo import PROJECT, ORIGIN, LOCAL_CRS
from build_speed_field import CUBETA, corredores, enganchar, indice

ROOT = Path(__file__).resolve().parents[1]
def read(p): return json.loads(p.read_text())
def write(p, v): p.write_text(json.dumps(v, ensure_ascii=False, separators=(',', ':'))+'\n')
def digest(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def normalized(v): return ''.join(c for c in unicodedata.normalize('NFD', v.lower()) if not unicodedata.combining(c))
def clock(s):
    import re
    m = re.fullmatch(r'(\d{1,2}):(\d{2})\s*(AM|PM)', s.strip())
    if not m: raise ValueError('Unknown time: '+s)
    h, minute = int(m[1]), int(m[2])
    if not 1 <= h <= 12 or minute > 59: raise ValueError(s)
    return ((h % 12)+(12 if m[3]=='PM' else 0))*3600+minute*60

# Cada 50 m se pregunta al campo por dónde va la ruta. Más fino no aporta: las cubetas son de 100 m.
PASO_PERFIL=50

def speed_profiles(routes,corridors,field):
    """Resuelve el campo medido a lo largo de cada ruta: [abscisa, velocidad de travesía, parte detenida].

    La velocidad es la de travesía —lo que el trecho le cuesta a un bus que pasa, sin la atención ni
    la cola de su propio servicio—, porque en calzada segregada un trecho congestionado se ve como
    bus lento y no como bus plantado. La parte detenida viaja al lado como evidencia; el motor no la
    usa para fabricar esperas.

    El campo está indexado por corredor y sentido, así que lo comparten todos los servicios que pasan
    por el mismo trecho, que es justo lo que hace que dos buses en el mismo sitio se muevan igual. Un
    punto que no engancha a ningún eje troncal —calle, dual, patio— no recibe nada y el motor cae a su
    modelo continuo; la parte enganchada de cada ruta va en `coverage`.
    """
    ejes=corredores({'corridors':corridors});malla=indice(ejes)
    largos={e['id']:e['length'] for e in ejes};salida={}
    for r in routes:
        if not r['ready'] or not r.get('points'):continue
        puntos=r['points'];acumulado=[0.0]
        for (x1,y1),(x2,y2) in zip(puntos,puntos[1:]):acumulado.append(acumulado[-1]+math.hypot(x2-x1,y2-y1))
        total=acumulado[-1];perfil=[];enganchadas=muestras=0;previo=None;sentido=1;ultimo=None;i=0
        for paso in range(int(total//PASO_PERFIL)+1):
            at=paso*PASO_PERFIL
            while i+1<len(acumulado)-1 and acumulado[i+1]<at:i+=1
            tramo=acumulado[i+1]-acumulado[i]
            t=0 if tramo<=0 else min(1,max(0,(at-acumulado[i])/tramo))
            x=puntos[i][0]+(puntos[i+1][0]-puntos[i][0])*t;y=puntos[i][1]+(puntos[i+1][1]-puntos[i][1])*t
            muestras+=1;enganche=enganchar(malla,x,y)
            if not enganche:
                previo=None;continue
            eje,abscisa=enganche
            if previo and previo[0]==eje:sentido=1 if abscisa>=previo[1] else -1
            previo=(eje,abscisa);enganchadas+=1
            cubeta=min(int(abscisa//CUBETA),int(largos[eje]//CUBETA))
            celda=field['buckets'].get(f'{eje}|{sentido}|{cubeta}')
            if not celda:continue
            valor=(round(celda['v_kmh']*10),round(celda['stop_share']*100))
            if valor!=ultimo:perfil.append([round(at),valor[0],valor[1]]);ultimo=valor
        if perfil:salida[r['id']]={'coverage':round(enganchadas/max(1,muestras),3),'profile':perfil}
    return salida

def build():
    snapshot = read(ROOT/'data/raw/services/latest.json')['snapshot']
    folder = ROOT/'data/raw/services'/snapshot
    catalog = read(folder/'selected_catalog.json')
    # Recuento del catálogo bruto del mapa digital, leído de la instantánea y no fijado a mano:
    # una descarga nueva con otro número de registros tiene que reflejarse sola.
    map_catalog = read(folder/'map_catalog.json')
    supplement=ROOT/'data/raw/services/supplement_20260910'
    extra=read(supplement/'selected_catalog.json') if (supplement/'selected_catalog.json').exists() else []
    extra_ids={str(r['id']) for r in extra}
    catalog+=extra
    # A refresh re-downloads the published detail of named records only. Catalogue metadata,
    # including validity, still comes from the base snapshot, so one record gaining a shape
    # never silently restates the rest of the catalogue.
    pointer=ROOT/'data/raw/services/refresh_latest.json'
    refresh=ROOT/'data/raw/services'/read(pointer)['snapshot'] if pointer.exists() else None
    refresh_ids={str(i) for i in read(pointer)['ids']} if pointer.exists() else set()
    stations = {}
    zones = {}
    for f in read(folder/'map_stations.geojson')['features']:
        p = f['properties']
        if p['zona']=='T': continue
        sid = str(p['id'])
        zones[p['zona']] = {'id':p['zona'], 'name':p['nom_tronc'], 'color':p['color']}
        stations[sid] = {'id':sid,'code':None,'name':p['nombre_estacion'], 'xy':list(PROJECT.transform(*f['geometry']['coordinates'])),
          'lon_lat':f['geometry']['coordinates'], 'zone':p['zona'],'kind':'station','status':p['estado'],
          'wagons':p['vagones'] or None, 'wagons_source':'published' if p['vagones'] else 'unknown',
          'coordinate_source':'map_stations', 'color':p['color']}
    ds = read(ROOT/'data/raw/dual_stops/latest.json')['snapshot']
    street_file = ROOT/'data/raw/dual_stops'/ds/'points.json'
    streets = {}
    for f in read(street_file)['features']:
        p=f['attributes']; code=p['cenefa']; xy=PROJECT.transform(f['geometry']['x'],f['geometry']['y'])
        streets.setdefault(code,[]).append(xy)
    corridors=[]
    for f in read(folder/'map_corridors.geojson')['features']:
        p=f['properties']
        if p['le_troncal']=='T':continue
        g=transform(PROJECT.transform,shape(f['geometry']))
        lines=list(g.geoms) if g.geom_type=='MultiLineString' else [g]
        corridors.append({'id':p['id_trazado'],'zone':p['le_troncal'],'name':p['nom_tronc'],'color':p['color'],
           'source_type':p['tipo_tra'],'kind':'street' if p['tipo_tra']==2 else 'trunk',
           'components':[[[round(x,2),round(y,2)] for x,y in l.coords] for l in lines]})
        zones.setdefault(p['le_troncal'], {'id':p['le_troncal'],'name':p['nom_tronc'],'color':p['color']})
    curated=read(ROOT/'data/curated/services.json')
    # Velocidad de marcha y tiempo detenido medidos por trecho de corredor; lo escribe build_speed_field.py.
    field=read(ROOT/'data/curated/speed_field.json')
    # Tipo de carrocería por servicio, deducido de la flota que lo atiende; lo escribe classify_fleet.py.
    # Un servicio sin lecturas no recibe perfil y el simulador lo declara estimado.
    fleet=read(ROOT/'data/curated/fleet_types.json')
    excluded=[]
    routes=[]
    for row in catalog:
        sid=str(row['id'])
        if sid in curated['excluded']:
            excluded.append(dict(curated['excluded'][sid],id=sid,name=row['nombre']))
            continue
        detail_folder=refresh if sid in refresh_ids else supplement if sid in extra_ids else folder
        d=read(detail_folder/'details'/f'{sid}.json'); meta=row.get('metadata') or {}
        z=(meta.get('troncal') or {}).get('zona')
        issues=[]; warnings=[]; calendar=[]
        for h in d['horario']:
            a,b=clock(h['inicio']),clock(h['fin'])
            calendar.append({'days':h['tipoDia'],'start':a,'end':b if b>a else b+86400})
        route={'id':sid,'code':row['codigo'],'name':d['nombre'] or row['nombre'],'color':d['color'] or row['color'],
           'source_scope':row['scope_source'],
           'detail_snapshot':detail_folder.name,
           'source_sha256':digest(detail_folder/'details'/f'{sid}.json'), 'valid_from':(meta.get('fechaDesde') or '')[:10],
           'valid_until':(meta.get('fechaHasta') or '')[:10], 'calendar':calendar, 'zone':z,
           'variant':'ciclovia' if 'ciclovia' in normalized(d['nombre'] or '') else 'regular',
           'issues':issues,'warnings':warnings,'stops':[], 'points':[]}
        route['calendar_policy']='published'
        if route['variant']=='ciclovia' and any(h['days']!='D-F' for h in calendar):
            issues.append('Variante Ciclovía con calendario ambiguo; requiere confirmar excepción.')
        if not calendar:issues.append('Sin horario publicado.')
        if not d['trazado'] or d['trazado'].get('type')!='LineString':
            issues.append('Sin trazado publicado.')
            line=None
        else:
            line=transform(PROJECT.transform,shape(d['trazado']))
            if line.length<100:issues.append('Trazado insuficiente.')
        if len(d['estaciones'])<2:issues.append('Sin secuencia suficiente de paradas.')
        previous=-1
        raw_stops=[]
        for i,s in enumerate(d['estaciones']):
            stopid=str(s['id']); at=float(s['posicion'] or 0); known=stations.get(stopid)
            if known:known['code']=s['codigo']
            if not known:
                candidates=streets.get(s['codigo'],[])
                exact=len(candidates)==1 and s['codigo'] not in ('BD','')
                xy=list(candidates[0]) if exact else list(line.interpolate(min(at,line.length)).coords)[0] if line else None
                known={'id':stopid,'code':s['codigo'],'name':s['nombre'],'xy':xy,'zone':None,'kind':'street',
                       'status':'Publicado en servicio','wagons':1,'wagons_source':'not_applicable',
                       'coordinate_source':'official_street_point' if exact else 'route_linear_reference_estimated','color':'#526876'}
                if xy:stations[stopid]=known
            correction=at; distance=None
            if line:
                if at>line.length+450:issues.append(f'Referencia de parada {s["codigo"]} fuera del trazado.')
                # Search near the linear reference, rather than nearest point on an entire loop.
                low,high=max(0,at-650),min(line.length,at+650)
                if low<high and known['xy'] and known['coordinate_source']!='route_linear_reference_estimated':
                    segment=substring(line,low,high); point=Point(known['xy'])
                    projected=segment.project(point); distance=segment.distance(point)
                    if distance<=250:correction=low+projected
                    elif distance>1200:issues.append(f'Parada {s["codigo"]} a {round(distance)} m del tramo publicado.')
                    else:warnings.append(f'{s["codigo"]}: ubicación de atención aproximada ({round(distance)} m del punto).')
                correction=min(line.length,max(0,correction))
                if correction<=previous:
                    if at>previous and at<=line.length:correction=at
                    else:issues.append(f'Orden de parada inconsistente: {s["codigo"]}.')
                previous=correction
            raw_stops.append({'station_id':stopid,'code':s['codigo'],'name':s['nombre'],'kind':known['kind'],
                'at_m':round(correction,3),'published_position_m':at,'coordinate_source':known['coordinate_source'],
                'snap_distance_m':None if distance is None else round(distance,1), 'wagons':known['wagons'] or 2,
                'wagons_source':known['wagons_source']})
        if line and len(raw_stops)>=2 and raw_stops[-1]['at_m']>raw_stops[0]['at_m']:
            start,end=raw_stops[0]['at_m'],raw_stops[-1]['at_m']; crop=substring(line,start,end)
            route['points']=[[round(x,3),round(y,3)] for x,y in crop.coords]
            route['length_m']=round(crop.length,3); route['source_crop_m']=[start,end]
            for s in raw_stops:s['at_m']=round(s['at_m']-start,3)
        route['stops']=raw_stops
        if not z and raw_stops:z=stations.get(raw_stops[-1]['station_id'],{}).get('zone')
        route['zone']=z or (route['code'][0] if route['code'][0].isalpha() else '?')
        zones.setdefault(route['zone'], {'id':route['zone'],'name':(meta.get('troncal') or {}).get('nombre') or ('Avenida 68' if route['zone']=='P' else 'Otros destinos'),'color':route['color']})
        route['dual']=any(s['kind']=='street' for s in raw_stops)
        # El tipo publicado manda sobre la observación: de F63/Z63 se conoce el modelo, no solo la familia.
        if route['code'] in ('F63','Z63'):
            route['vehicle_profile']={'type':'dual_articulated_electric','capacity':160,'status':'published','source':'comunicado oficial de 2026 sobre los duales eléctricos'}
        elif route['code'] in fleet['routes'] and fleet['routes'][route['code']]['status']!='unresolved':
            observed=fleet['routes'][route['code']]
            route['vehicle_profile']={'type':observed['type'],'capacity':observed['capacity'],'status':observed['status'],
                'buses':observed['buses'],'source':'fleet_labels',
                'source_feed':fleet['sources']['feed']}
        route['served_zones']=sorted({stations[s['station_id']]['zone'] for s in raw_stops if s['station_id'] in stations and stations[s['station_id']]['zone']})
        route['issues']=list(dict.fromkeys(issues));route['warnings']=list(dict.fromkeys(warnings))
        route['ready']=bool(route['points']) and not route['issues']
        routes.append(route)
    for r in routes:
        r['paired_ids']=[]
        for pair in curated['pairs']:
            if r['id'] in pair:r['paired_ids'].extend(i for i in pair if i!=r['id'])
    # Numeric codes have two legitimate directions: origin/destination remain part of identity.
    for r in routes:
        r['family']=r['code']+(':'+r['stops'][0]['station_id'] if r['code'].isdigit() and r['stops'] else '')
    # Generalized background only: service shapes themselves remain unmodified.
    trunk_mask=unary_union([LineString(line) for c in corridors if c['kind']=='trunk' for line in c['components']]).buffer(18)
    street_context=[line for c in corridors if c['kind']=='street' for line in c['components']]
    displayed_mask=trunk_mask.union(unary_union([LineString(line) for line in street_context]).buffer(18))
    for r in routes:
        if not r['ready'] or not r['dual']:continue
        remainder=LineString(r['points']).difference(displayed_mask)
        lines=list(remainder.geoms) if remainder.geom_type=='MultiLineString' else [remainder]
        for line in lines:
            if line.geom_type=='LineString' and line.length>=30:street_context.append([[round(x,1),round(y,1)] for x,y in line.simplify(5).coords])
    xy=[p for c in corridors for line in c['components'] for p in line]
    return {'schema_version':2,'revision':'services-v2-'+snapshot,'snapshot':snapshot,'scenario_date':'2026-09-10',
       'origin_lon_lat':ORIGIN,'projection':LOCAL_CRS.to_string(),'coordinate_frame':'XY east/north metres; 1:1',
       'bounds':[min(p[0] for p in xy),min(p[1] for p in xy),max(p[0] for p in xy),max(p[1] for p in xy)],
       'source_hashes':{'catalog':digest(folder/'selected_catalog.json'),'stations':digest(folder/'map_stations.geojson'),'street_stops':digest(street_file),'corridors':digest(folder/'map_corridors.geojson'),'curation':digest(ROOT/'data/curated/services.json'),'fleet_types':digest(ROOT/'data/curated/fleet_types.json'),'speed_field':digest(ROOT/'data/curated/speed_field.json'),'refresh_manifest':digest(refresh/'manifest.json') if refresh else None,'supplement_catalog':digest(supplement/'selected_catalog.json')},
       'attribution':'TRANSMILENIO S.A. · catálogo de servicios; IDECA · paraderos duales',
       'license_notes':'Licencia del catálogo de servicios no establecida; paraderos según catálogo original. Uso local.',
       'assumptions':{'berth_assignment':'Estimated deterministic service-to-wagon allocation; not a published assignment',
          'lanes':'One stopping lane and one independent passing lane per direction, user-selected abstraction',
          'frequency':'Configurable estimate, not official headways','demand':'Configurable synthetic boarding/alighting, no passenger OD survey',
          'linear_reference':'Local projection within 650m of published chainage; unlocated street stops interpolate official shape',
          'depot':'Abstract vehicle staging at journey origin; no invented yard access geometry',
          'speed_profile':'Rolling speed and stopped share per 100 m of corridor, measured from fleet position readings; the published stretch time still sets the total',
          'vehicle_type':'Body type per service read from the fleet labels seen in position readings; services without readings fall back to the articulated reference, marked as an estimate'},
       'counts':{'map_records':len(map_catalog),'map_codes':len({r['codigo'] for r in map_catalog}),'records':len(routes),'excluded':len(excluded),'ready':sum(r['ready'] for r in routes),'pending':sum(not r['ready'] for r in routes)},
       'street_context':street_context,'excluded':excluded,'corridors':corridors,'stations':list(stations.values()),'routes':routes,'zones':sorted(zones.values(),key=lambda z:z['id']),
       'vehicle':{'length_m':18.5,'width_m':2.5,'capacity':160,'label':'Articulado de referencia; perfiles por servicio en vehicles.mjs'},
       'fleet_types':{k:fleet[k] for k in ('observed_from','method','fleet_seen','observed_ranges','sources')}}

if __name__=='__main__':
    data=build();write(ROOT/'app/dist/services.json',data)
    field=read(ROOT/'data/curated/speed_field.json')
    profiles=speed_profiles(data['routes'],data['corridors'],field)
    write(ROOT/'app/dist/speed_profiles.json',{'schema_version':1,'step_m':PASO_PERFIL,
       'field':{k:field[k] for k in ('observed_from','excluded_reason',
                                     'assumptions','parameters','coverage','fallback') if k in field},
       'routes':profiles})
    cubierto=[p['coverage'] for p in profiles.values()]
    print(json.dumps({'speed_profiles':len(profiles),'coverage_median':round(sorted(cubierto)[len(cubierto)//2],3) if cubierto else None}))
    audit={'counts':data['counts'],'snapshot':data['snapshot'],'routes':[{k:r[k] for k in ['id','code','name','ready','valid_from','valid_until','issues','warnings']} for r in data['routes']]}
    write(ROOT/'data/processed/services_audit.json',audit)
    print(json.dumps(data['counts']))
    for r in data['routes']:
        if not r['ready']:print(r['id'],r['code'],'; '.join(r['issues'])[:220])
