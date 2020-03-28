const crypto = require('crypto');
const db = require('./database.js');
const config = require('./config.js');

/**
 * Pads an array with a given string, returns a copy
 */
function padWithStrings(array, string, size) {
  const newArray = [];
  for (var i = 0; i < array.length; ++i) {
    newArray.push(array[i]);
  }

  if (size <= array.length) return newArray;

  for (var i = array.length; i < size; ++i) {
    newArray.push(string);
  }

  return newArray;
}

function validateUserHash(hash) {
  return new Promise((resolve, reject) => {
    db.query(
      'SELECT COUNT(*) FROM users WHERE hash = ?',
      [hash],
      (error, results) => {
        const count = results[0]['COUNT(*)'];
        resolve(count === 1);
      }
    );
  });
}

const resolvers = {
  Query: {
    hello: () => 'Hello world!',
    user: (parent, args, context, info) => {
      return new Promise(async (resolve) => {
        db.query(
          'SELECT nickname FROM users WHERE hash = ?',
          [args.userHash],
          async function (error, results) {
            if (results.length !== 1) {
              return resolve(null);
            }

            const gameHash = await new Promise((resolveHash) => {
              db.query(
                'SELECT hash, players FROM games WHERE stage != 0',
                function (error, results) {
                  let foundGame = false;
                  results.forEach((val) => {
                    if (foundGame) return;
                    if (JSON.parse(val.players).includes(args.userHash)) {
                      resolveHash(val.hash);
                      foundGame = true;
                    }
                  });
                  if (!foundGame) {
                    resolveHash(null);
                  }
                }
              );
            });

            return resolve({
              hash: args.userHash,
              nickname: results[0].nick,
              inGame: gameHash,
            });
          }
        );
      });
    },
    game: (parent, args, context, info) => {
      return new Promise((resolve) => {
        db.query(
          'SELECT * FROM games WHERE hash = ?',
          [args.gameHash],
          async function (error, results) {
            if (results.length !== 1) {
              return resolve(null);
            }

            const game = results[0];
            game.players = JSON.parse(game.players);

            hashes = padWithStrings(game.players, '', 4);
            const players = await new Promise((resolvePlayers) => {
              // TODO: make this dependent on maxPlayers instead of being hardcoded
              db.query(
                'SELECT hash, nickname FROM users WHERE hash IN (?, ?, ?, ?)',
                hashes,
                function (error, results) {
                  return resolvePlayers(results);
                }
              );
            });

            let myPosition = hashes.indexOf(args.userHash);
            if (myPosition === -1) {
              myPosition = null;
            }

            const nicknames = [];
            game.players.forEach((hash) => {
              let nickname;
              for (let i = 0; i < players.length; i++) {
                if (players[i].hash === hash) {
                  nickname = players[i].nickname;
                  break;
                }
              }
              nicknames.push(nickname);
            });

            let stage;
            switch (game.stage) {
              case 0:
                stage = 'FINISHED';
                break;
              case 1:
                stage = 'PREGAME';
                break;
              case 2:
                stage = 'PLAY';
                break;
            }

            let declaredTiles = null;
            let discardTiles = null;
            let playerTiles = null;
            let turn = null;
            let east = null;
            let startTime = null;
            if (game.stage !== 1) {
              declaredTiles = JSON.parse(game.declaredTiles);
              discardTiles = JSON.parse(game.discardTiles);
              playerTiles = JSON.parse(game.playerTiles);
              turn = game.turn;
              east = game.east;
              startTime = game.startTime;
            }

            return resolve({
              nicknames,
              stage,
              turn,
              east,
              declaredTiles,
              discardTiles,
              playerTiles,
              myPosition,
              startTime,
              joinCode: game.joinCode,
            });
          }
        );
      });
    },
  },

  Mutation: {
    createUser: (parent, args, context, info) => {
      const hash = crypto.randomBytes(32).toString('hex');
      db.query('INSERT INTO users (hash, nickname) VALUES (?, ?)', [
        hash,
        args.nickname,
      ]);

      return hash;
    },
    createGame: (parent, args, context, info) => {
      const joinCode = `000${Math.floor(Math.random() * 10000)}`.slice(-4);
      const hash = crypto.randomBytes(32).toString('hex');
      const players = JSON.stringify([args.userHash]);
      db.query(
        'INSERT INTO games (hash, joinCode, players, stage) VALUES (?, ?, ?, 1)',
        [hash, joinCode, players]
      );

      return hash;
    },
    joinGame: (parent, args, context, info) => {
      return new Promise(async (resolve, reject) => {
        if (!(await validateUserHash(args.userHash))) {
          return resolve(null);
        }
        db.query(
          'SELECT hash, players FROM games WHERE joinCode = ? AND stage != 0',
          [args.gameCode],
          (error, results) => {
            if (results.length !== 1) {
              return resolve(null);
            }

            /* Add player to list of players */
            const game = results[0];
            const players = JSON.parse(game.players);
            if (players.length >= config.maxPlayers) {
              /* TODO allow join to spectate? */
              return resolve(null);
            } else if (!players.includes(args.userHash)) {
              players.push(args.userHash);
              db.query('UPDATE games SET players = ? WHERE hash = ?', [
                JSON.stringify(players),
                game.hash,
              ]);
            }

            return resolve(game.hash);
          }
        );
      });
    },
  },
};

module.exports = resolvers;
