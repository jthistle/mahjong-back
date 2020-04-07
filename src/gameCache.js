const db = require('./database.js');
const gameModel = require('./gameModel.js');
const { GAME_STAGE } = require('./const.js');

const games = {};

const stageMap = {
  1: GAME_STAGE.pregame,
  2: GAME_STAGE.play,
};

db.query(
  'SELECT hash, events, players, nicknames, stage, joinCode FROM games WHERE stage != 0',
  (error, results) => {
    if (error) {
      console.error('error: ', error);
    }
    results.forEach((game) => {
      let events = game.events === '' ? null : JSON.parse(game.events);
      games[game.hash] = gameModel(
        game.hash,
        JSON.parse(game.players),
        JSON.parse(game.nicknames),
        game.joinCode,
        stageMap[game.stage],
        events
      );
    });
  }
);

module.exports = games;
