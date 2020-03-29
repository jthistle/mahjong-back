const db = require('./database.js');
const gameModel = require('./gameModel.js');

const games = {};

db.query(
  'SELECT hash, events, players FROM games WHERE stage != 0',
  (error, results) => {
    if (error) {
      console.error('error: ', error);
    }
    results.forEach((game) => {
      let events = game.events === '' ? null : JSON.parse(game.events);
      games[game.hash] = gameModel(game.hash, JSON.parse(game.players), events);
    });
  }
);

module.exports = games;
