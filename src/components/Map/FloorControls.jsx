export default function FloorControls({ activeFloor, onFloorChange, floors = {} }) {
  // Top floor first, like a lift panel (object keys like '-2' and '0' would
  // otherwise come out in JavaScript's key order).
  const floorEntries = (Array.isArray(floors)
    ? floors
    : Object.entries(floors).map(([value, data]) => ({
        value: Number(value),
        code: data.code || `F${value}`,
        label: data.label,
      }))
  ).sort((a, b) => Number(b.value ?? b) - Number(a.value ?? a))

  return (
    <div className="floor-controls-widget">
      {floorEntries.map((floor) => {
        const floorVal = typeof floor.value !== 'undefined' ? floor.value : floor
        const isActive = Number(activeFloor) === Number(floorVal)

        return (
          <button
            key={floorVal}
            type="button"
            className={`floor-btn ${isActive ? 'active' : ''}`}
            onClick={() => onFloorChange(floorVal)}
            title={floor.label}
          >
            {floor.code || `F${floorVal}`}
          </button>
        )
      })}
    </div>
  )
}
