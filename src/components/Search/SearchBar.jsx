import { Search, X } from 'lucide-react'
import { getFloorLabel } from '../../utils/floors'
import { getRoomName } from '../../utils/rooms'

function SearchBar({
  label,
  placeholder,
  value,
  onChange,
  results = [],
  selectedRoom,
  onSelect,
  onClear,
  disabled = false,
  action = null,
  note = '',
  alternatives = [],
}) {
  return (
    <div className="search-field">
      <div className="field-label-row">
        <label className="field-label">{label}</label>
        {action}
      </div>
      <div className="search-input-wrap">
        <Search size={15} className="field-icon" />
        <input
          type="text"
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          aria-label={label}
        />
        {selectedRoom ? <small className="floor-badge in-input">{getFloorLabel(selectedRoom.floor)}</small> : null}
        {value && !disabled ? (
          <button type="button" className="clear-button" onClick={onClear} aria-label={`Clear ${label}`}>
            <X size={14} />
          </button>
        ) : null}
      </div>

      {note ? <p className="field-note">{note}</p> : null}

      {selectedRoom && alternatives.length > 0 ? (
        <div className="nearby-alternatives">
          <span>Not right? Nearby:</span>
          {alternatives.map((room) => (
            <button key={room.node_id} type="button" disabled={disabled} onClick={() => onSelect(room)}>
              {getRoomName(room)}
              {Number.isFinite(room.distance_m) ? <small>{Math.round(room.distance_m)} m</small> : null}
            </button>
          ))}
        </div>
      ) : null}

      {value && !selectedRoom && results.length > 0 ? (
        <ul className="search-results">
          {results.map((room) => (
            <li key={room.node_id}>
              <button type="button" onClick={() => onSelect(room)}>
                <span>{getRoomName(room)}</span>
                <small className="floor-badge">{getFloorLabel(room.floor)}</small>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {value && !selectedRoom && results.length === 0 ? (
        <p className="empty-search">
          No room found.
          <br />
          Kindly check the room name properly.
        </p>
      ) : null}
    </div>
  )
}

export default SearchBar
