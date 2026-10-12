import { FLOORS } from '../../utils/floors'
export default function FloorControls({ activeFloor, onFloorChange, floors = {} }) {
  // Convert object entries to an array for safe iteration
  const floorEntries = Array.isArray(floors)
    ? floors
    : Object.entries(floors).map(([value, data]) => ({
        value: Number(value),
        code: data.code || `F${value}`,
        label: data.label,
      }))

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
          >
            {floor.code || `F${floorVal}`}
          </button>
        )
      })}
    </div>
  )
}