import { MapContainer, Marker, TileLayer, useMapEvents } from "react-leaflet";
import { industryIcon, TILE_ATTR, TILE_URL } from "./markers";

function ClickHandler({ onPick }: { onPick: (lat: number, lon: number) => void }) {
  useMapEvents({ click: (e) => onPick(+e.latlng.lat.toFixed(5), +e.latlng.lng.toFixed(5)) });
  return null;
}

export default function PinPicker({ lat, lon, type, onPick, center }: {
  lat: number; lon: number; type: string; onPick: (lat: number, lon: number) => void; center: [number, number];
}) {
  return (
    <div className="h-72 rounded-lg overflow-hidden border border-border">
      <MapContainer key={center.join(",")} center={center} zoom={11} className="h-full w-full">
        <TileLayer url={TILE_URL} attribution={TILE_ATTR} />
        <ClickHandler onPick={onPick} />
        <Marker position={[lat, lon]} icon={industryIcon(type || "steel", 32, true)} />
      </MapContainer>
    </div>
  );
}
