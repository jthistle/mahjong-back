const db = require('./database.js');
const config = require('./config.js');
const gameCache = require('./gameCache.js');

const MIN_TIMEOUT = 500; /* ms */

function syncQuery(query, params) {
  return new Promise((resolve) => {
    db.query(query, params, (error, results) => {
      resolve(results);
    });
  });
}

function gameManager() {
  const run = async () => {
    while (true) {
      const start = Date.now();

      const waitingGames = await syncQuery(
        'SELECT hash, players FROM games WHERE stage = 1',
        []
      );

      waitingGames.forEach((game) => {
        const players = JSON.parse(game.players);
        if (players.length === config.maxPlayers) {
          gameCache[game.hash].initNew();
          db.query('UPDATE games SET stage = 2 WHERE hash = ?', [game.hash]);
        }
      });

      await new Promise((resolve) =>
        setTimeout(resolve, MIN_TIMEOUT - (Date.now() - start))
      );
    }
  };

  return {
    run,
  };
}

const manager = gameManager();

module.exports = manager;
