"""Shared geographic reference for the 2D simulator; metres without compression."""
from pyproj import CRS, Transformer
ORIGIN = (-74.136, 4.63027)
LOCAL_CRS = CRS.from_proj4(f'+proj=aeqd +lat_0={ORIGIN[1]} +lon_0={ORIGIN[0]} +datum=WGS84 +units=m +no_defs')
PROJECT = Transformer.from_crs('EPSG:4326', LOCAL_CRS, always_xy=True)
