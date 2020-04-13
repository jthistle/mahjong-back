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
  augmentDeclared: 'AUGMENT_DECLARED',
  mahjong: 'MAHJONG',
  roundEnd: 'ROUND_END',
  gameEnd: 'GAME_END',
};

const GAME_STAGE = {
  pregame: 'PREGAME',
  play: 'PLAY',
  finished: 'FINISHED',
};

const GAME_STAGE_TO_INT = {
  PREGAME: 1,
  PLAY: 2,
  FINISHED: 0,
};

module.exports = {
  TURN_STATE,
  EVENT,
  GAME_STAGE,
  GAME_STAGE_TO_INT,
};
