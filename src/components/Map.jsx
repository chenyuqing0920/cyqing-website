import React,{useEffect,useRef} from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
export default function Map({items,onSelect}){
 const ref=useRef(null),mapRef=useRef(null),handler=useRef(onSelect);handler.current=onSelect;
 useEffect(()=>{if(!ref.current)return;const map=L.map(ref.current,{scrollWheelZoom:false}).setView([30,105],4);mapRef.current=map;L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:18,attribution:'&copy; OpenStreetMap contributors'}).addTo(map);return()=>{map.remove();mapRef.current=null;};},[]);
 useEffect(()=>{const map=mapRef.current;if(!map)return;const layers=L.layerGroup().addTo(map),points=[];for(const item of items){if(item.latitude==null||item.longitude==null||item.status!=='已去')continue;const point=[item.latitude,item.longitude];points.push(point);const marker=L.circleMarker(point,{radius:8,color:'#fff',weight:2,fillColor:'#db83a9',fillOpacity:1}).addTo(layers);marker.bindTooltip(item.title);marker.on('click',()=>handler.current(item));}if(points.length)map.fitBounds(points,{padding:[35,35],maxZoom:10});return()=>layers.remove();},[items]);
 return <div className="travel-map" ref={ref} aria-label="旅行地图"/>;
}
