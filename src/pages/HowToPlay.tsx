interface HowToPlayProps {
  onLogout: () => void
}

function HowToPlay({ onLogout }: HowToPlayProps) {
  return (
    <div>
      <h1>How to Play</h1>
      <p>Tutorial coming soon...</p>
      <button type="button" onClick={onLogout}>Logout</button>
    </div>
  )
}

export default HowToPlay
