import { CloseIcon, SearchIcon } from './icons.tsx'

type Props = { value: string; onChange: (value: string) => void }

export function SearchBox({ value, onChange }: Props) {
  return (
    <div className="search">
      <SearchIcon className="search-icon" />
      <input
        type="search"
        placeholder="Buscar bar o terraza…"
        aria-label="Buscar bar o terraza"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {value !== '' && (
        <button
          type="button"
          className="icon-button search-clear"
          aria-label="Borrar búsqueda"
          onClick={() => onChange('')}
        >
          <CloseIcon size={16} />
        </button>
      )}
    </div>
  )
}
