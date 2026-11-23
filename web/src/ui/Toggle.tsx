type Props = {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
}

/** An accessible on/off switch (a checkbox with role="switch"). */
export function Toggle({ checked, onChange, label }: Props) {
  return (
    <input
      type="checkbox"
      role="switch"
      className="toggle"
      aria-label={label}
      checked={checked}
      onChange={(event) => onChange(event.target.checked)}
    />
  )
}
