/** liga/desliga com cara de switch (role="switch" para leitor de tela) */
export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className={`switch${checked ? ' on' : ''}`} onClick={() => onChange(!checked)}>
      <span className="switch-knob" />
    </button>
  )
}
