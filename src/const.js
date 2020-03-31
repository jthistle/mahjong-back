const TURN_STATE = {
  waitingForDiscard: 'waitingForDiscard',
  waitingForClaims: 'waitingForClaims',
};

/**
 * Event types, vals should be kept in sync with GraphQL enum.
 */
const EVENT = {
  roundStart: 'ROUND_START',
  setEast: 'SET_EAST',
  startTurn: 'START_TURN',
  pickupWall: 'PICKUP_WALL',
  pickupTable: 'PICKUP_TABLE',
  discard: 'DISCARD',
  declare: 'DECLARE',
  mahjong: 'MAHJONG',
  roundEnd: 'ROUND_END',
  gameEnd: 'GAME_END',
};

module.exports = {
  TURN_STATE,
  EVENT,
};
