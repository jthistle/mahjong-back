const db = require('./database.js');
const config = require('./config.js');
const gameCache = require('./gameCache.js');
const { TURN_STATE, GAME_STAGE } = require('./const.js');

const MIN_TIMEOUT = 500; /* ms */

function gameManager() {
  const run = async () => {
    while (true) {
      const start = Date.now();

      Object.keys(gameCache).forEach((hash) => {
        const game = gameCache[hash];
        if (!game) {
          return;
        }

        if (game.gameStage() === GAME_STAGE.pregame) {
          if (game.playerCount() === config.maxPlayers && game.playersReady()) {
            game.newRound();
          }
        } else if (game.gameStage() === GAME_STAGE.finished) {
          /* Remove game from cache if it is finished */
          gameCache[hash] = undefined;
        } else if (
          game.turnState() === TURN_STATE.waitingForClaims &&
          !game.locked() &&
          game.timeSinceLastEvent() >= config.claimTime
        ) {
          game.nextTurn();
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
