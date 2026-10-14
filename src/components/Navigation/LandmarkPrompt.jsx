// Footer card for landmark questions during a journey ("When you turned left,
// did you see a door labelled TF34?"). Answers correct the user's position.
export default function LandmarkPrompt({ prompt, onYes, onNo, onPick, onNoneOfThese, onKeepGoing, onEndJourney }) {
  if (!prompt) return null

  if (prompt.stage === 'feedback') {
    return (
      <aside className="landmark-prompt feedback" role="status">
        <p>{prompt.message}</p>
      </aside>
    )
  }

  if (prompt.stage === 'lost') {
    return (
      <aside className="landmark-prompt" role="dialog" aria-label="You may be off course">
        <p className="landmark-question">You may have gone off course.</p>
        <p className="landmark-hint">
          Head back to the last place you recognised and keep following the line. If you are lost, end the
          journey and start again from the nearest room.
        </p>
        <div className="landmark-actions">
          <button type="button" className="landmark-yes" onClick={onKeepGoing}>
            Keep going
          </button>
          <button type="button" className="landmark-no" onClick={onEndJourney}>
            End journey
          </button>
        </div>
      </aside>
    )
  }

  if (prompt.stage === 'alternatives') {
    return (
      <aside className="landmark-prompt" role="dialog" aria-label="What do you see?">
        <p className="landmark-question">What do you see around you?</p>
        <div className="landmark-options">
          {prompt.options.map((option) => (
            <button key={option.node.node_id} type="button" onClick={() => onPick(option)}>
              {option.label}
            </button>
          ))}
          <button type="button" className="none" onClick={onNoneOfThese}>
            None of these
          </button>
        </div>
      </aside>
    )
  }

  return (
    <aside className="landmark-prompt" role="dialog" aria-label="Check your position">
      <p className="landmark-question">{prompt.checkpoint.question}</p>
      <div className="landmark-actions">
        <button type="button" className="landmark-yes" onClick={onYes}>
          Yes
        </button>
        <button type="button" className="landmark-no" onClick={onNo}>
          No
        </button>
      </div>
    </aside>
  )
}
