// Turn-by-turn helpers for a journey: where each instruction happens along
// the route, what to show next, and which landmarks to ask about.
//
// Distances here are "route metres": distance along the journey's polyline,
// the same units as the tracker's travelledM.

const TURN_QUESTION_AFTER_M = 2 // ask shortly after the user has made the turn
const MIN_QUESTION_GAP_M = 6 // never two questions closer than this
const STALE_QUESTION_M = 15 // drop an unanswered turn question once well past it
const STAIRS_COVER_TURN_M = 8 // a turn this close before the stairs is checked at the stairs
const LEAVING_START_M = 6 // the first turn out of the start room's door is not worth a question
const ALTERNATIVES_BEHIND_M = 12
const ALTERNATIVES_AHEAD_M = 15

/** What to do at an instruction; uses the backend's `maneuver`, else parses the text. */
export function maneuverOf(instruction) {
  if (instruction?.maneuver) return instruction.maneuver
  const text = (instruction?.text ?? '').toLowerCase()
  const turn = text.match(/turn (left|right)/)
  if (turn) return turn[1]
  const floor = text.match(/(stairs|elevator)\s+(up|down)/)
  if (floor) return `${floor[1]}_${floor[2]}`
  if (text.startsWith('destination')) return 'arrive'
  return 'straight'
}

export const isFloorChange = (maneuver) => /_(up|down)$/.test(maneuver ?? '')
export const isTurn = (maneuver) => maneuver === 'left' || maneuver === 'right'

/** "TF34" from "TF34 Main Door"; null when the name carries no room code. */
export function roomCodeOf(name) {
  const match = (name ?? '').trim().match(/^([A-Z]{1,2}\s?\d{1,3}[A-Z]?)\b/i)
  return match ? match[1].replace(/\s+/g, '').toUpperCase() : null
}

const isWallOpening = (node) => /door|window|entrance/i.test(node?.type ?? '')

/** How to describe a node to someone looking for it, or null if it is not a useful landmark. */
export function landmarkPhrase(node) {
  if (!node || !isWallOpening(node)) return null
  const code = roomCodeOf(node.name)
  if (code) return `a door labelled ${code}`
  const name = (node.name ?? '').trim()
  return name ? `the ${name.replace(/\s+door\s*\d*$/i, '')} door` : null
}

/** Places every instruction on the route (route metres), using the tracker. */
export function buildSteps(route, tracker) {
  const path = route?.path ?? []
  if (!tracker || !path.length) return []
  const byId = new Map(path.map((node, index) => [node.node_id, { node, index }]))
  const steps = []
  for (const instruction of route.instructions ?? []) {
    const maneuver = maneuverOf(instruction)
    let entry = byId.get(instruction.node_id)
    if (!entry && maneuver === 'arrive') entry = { node: path[path.length - 1], index: path.length - 1 }
    if (!entry) continue
    const s = tracker.locate(entry.node.y, entry.node.x, entry.node.floor)
    if (s === null) continue
    steps.push({ ...instruction, maneuver, node: entry.node, pathIndex: entry.index, s })
  }
  // "Continue straight" to the destination says less than "arrive" at the
  // same spot, so the bar shows the arrival instead.
  const arrival = steps.find((step) => step.maneuver === 'arrive')
  return steps
    .filter((step) => !(arrival && step.maneuver === 'straight' && step.node.node_id === arrival.node.node_id))
    .sort((a, b) => a.s - b.s)
}

/** The next instruction ahead of the user, or the arrival. */
export function nextStep(steps, travelledM) {
  return steps.find((step) => step.s > travelledM + 0.5) ?? steps[steps.length - 1] ?? null
}


/**
 * Landmark questions: one at every stair and at most turns (where there is a
 * labelled door nearby to ask about). Each has a trigger position in route
 * metres; stair questions trigger when the user reaches the stairs.
 */
export function buildCheckpoints(route, steps, tracker) {
  const path = route?.path ?? []
  const checkpoints = []
  let lastAt = -Infinity

  const labelled = (from, to) => {
    const found = []
    for (let index = Math.max(0, from); index <= Math.min(path.length - 1, to); index += 1) {
      const phrase = landmarkPhrase(path[index])
      if (phrase) found.push({ node: path[index], index, phrase })
    }
    return found
  }

  for (const step of steps) {
    if (isFloorChange(step.maneuver)) {
      const near = labelled(step.pathIndex - 3, step.pathIndex)
        .filter((candidate) => candidate.node.floor === step.node.floor)
        .pop()
      checkpoints.push({
        id: `stairs-${step.node.node_id}`,
        kind: 'stairs',
        floor: step.node.floor,
        s: step.s,
        landmark: near?.node ?? null,
        question: near ? `Are you at the stairs near ${near.phrase}?` : 'Have you reached the stairs?',
      })
      lastAt = step.s
      continue
    }
    if (!isTurn(step.maneuver) || step.s < LEAVING_START_M) continue
    // Stairs just after the turn get their own question; one is enough.
    if (steps.some((other) => isFloorChange(other.maneuver) && other.s >= step.s && other.s - step.s <= STAIRS_COVER_TURN_M)) continue
    const candidates = labelled(step.pathIndex - 1, step.pathIndex + 3).filter(
      (candidate) => candidate.node.floor === step.node.floor,
    )
    // Prefer a door the user passes just after turning.
    const after = candidates.find((candidate) => candidate.index >= step.pathIndex)
    const landmark = after ?? candidates.pop()
    if (!landmark) continue
    const landmarkS = tracker.locate(landmark.node.y, landmark.node.x, landmark.node.floor) ?? step.s
    const at = Math.max(step.s, landmarkS) + TURN_QUESTION_AFTER_M
    if (at - lastAt < MIN_QUESTION_GAP_M) continue
    checkpoints.push({
      id: `turn-${step.node.node_id}`,
      kind: 'turn',
      floor: step.node.floor,
      s: at,
      landmark: landmark.node,
      landmarkS,
      question: after
        ? `When you turned ${step.maneuver}, did you see ${landmark.phrase}?`
        : `Just before you turned ${step.maneuver}, did you pass ${landmark.phrase}?`,
    })
    lastAt = at
  }
  return checkpoints
}

/** The question to show now, if any (derived from the tracker snapshot). */
export function activeCheckpoint(checkpoints, answered, snapshot) {
  if (!snapshot || snapshot.status === 'arrived' || snapshot.calibrating) return null
  for (const checkpoint of checkpoints) {
    if (answered.has(checkpoint.id)) continue
    if (checkpoint.kind === 'stairs') {
      if (snapshot.status === 'at_stairs' && snapshot.floor === checkpoint.floor) return checkpoint
      continue
    }
    if (snapshot.status !== 'tracking' || snapshot.floor !== checkpoint.floor) continue
    const travelled = snapshot.travelledM
    if (travelled >= checkpoint.s && travelled < checkpoint.s + STALE_QUESTION_M) return checkpoint
  }
  return null
}

/** Labelled doors on the route around the user, for "What do you see instead?" */
export function nearbyLandmarks(route, tracker, snapshot, excludeNode) {
  if (!snapshot) return []
  // The door the user just said No to, and any other door with its label.
  const excludedCode = roomCodeOf(excludeNode?.name)
  const seen = new Set()
  const options = []
  for (const node of route?.path ?? []) {
    if (node.node_id === excludeNode?.node_id || node.floor !== snapshot.floor) continue
    const code = roomCodeOf(node.name)
    const phrase = landmarkPhrase(node)
    if (!phrase || (code && code === excludedCode) || seen.has(code ?? node.name)) continue
    const s = tracker.locate(node.y, node.x, node.floor)
    if (s === null || s < snapshot.travelledM - ALTERNATIVES_BEHIND_M || s > snapshot.travelledM + ALTERNATIVES_AHEAD_M) continue
    seen.add(code ?? node.name)
    const label = code ?? node.name.replace(/\s+door\s*\d*$/i, '')
    options.push({ node, s, label, distance: Math.abs(s - snapshot.travelledM) })
  }
  return options.sort((a, b) => a.distance - b.distance).slice(0, 3)
}
