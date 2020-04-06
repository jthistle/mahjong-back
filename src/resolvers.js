const crypto = require('crypto');
const { GraphQLScalarType } = require('graphql');
const { Kind } = require('graphql/language');

const db = require('./database.js');
const config = require('./config.js');
const gameCache = require('./gameCache.js');
const gameModel = require('./gameModel.js');
const { GAME_STAGE } = require('./const.js');

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

/**
 * Custom definition of a timestamp scalar type.
 */
const Timestamp = new GraphQLScalarType({
  name: 'Timestamp',
  description: 'A UNIX epoch timestamp in milliseconds',
  /* Returning value to client */
  serialize(value) {
    if (value > Number.MAX_SAFE_INTEGER) {
      throw new Error('Value is greater than maximum safe integer!');
    }
    return value;
  },
  /* Value recieved from client */
  parseValue(value) {
    if (value > Number.MAX_SAFE_INTEGER) {
      throw new Error('Value is greater than maximum safe integer!');
    }
    return value;
  },
  /* Parsing a literal in the schema */
  parseLiteral(ast) {
    if (ast.kind === Kind.INT) {
      return new Number(ast.value);
    }
    return null;
  },
});

/**
 * The resolver map mega-object.
 */
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

            return resolve({
              nicknames,
              stage,
              myPosition,
              joinCode: game.joinCode,
            });
          }
        );
      });
    },
    events: (parent, args, context, info) => {
      const game = gameCache[args.gameHash];
      if (!game) {
        return null;
      }

      if (args.offset == game.lastEventId()) {
        return {
          offset: args.offset,
          events: [],
        };
      }

      userPlayerInd = game.playerId(args.userHash);
      sanitisedEvents = [];
      i = 0;
      gameCache[args.gameHash].forEachEvent((event) => {
        if (i++ <= args.offset) {
          return;
        }
        if (event.type === 'PICKUP_WALL' && event.player !== userPlayerInd) {
          return;
        }

        /* TODO check if this is safe without copy */
        sanitisedEvents.push(event);
      });

      return {
        offset: game.lastEventId(),
        events: sanitisedEvents,
      };
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
      return new Promise((resolve) => {
        console.log('creating game');
        const joinCode = `000${Math.floor(Math.random() * 10000)}`.slice(-4);
        const hash = crypto.randomBytes(32).toString('hex');
        const players = JSON.stringify([args.userHash]);
        db.query(
          'INSERT INTO games (hash, joinCode, players, stage) VALUES (?, ?, ?, 1)',
          [hash, joinCode, players],
          (error) => {
            console.log('error?', error);
            gameCache[hash] = gameModel(
              hash,
              [args.userHash],
              GAME_STAGE.pregame
            );
            return resolve(hash);
          }
        );
      });
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
              db.query(
                'UPDATE games SET players = ? WHERE hash = ?',
                [JSON.stringify(players), game.hash],
                () => {
                  gameCache[game.hash].addPlayer(args.userHash);
                }
              );
            }

            return resolve(game.hash);
          }
        );
      });
    },
    setReady: (parent, args, context, info) => {
      const game = gameCache[args.gameHash];
      if (!game) {
        return false;
      }
      return game.playerSetReady(args.userHash, args.ready);
    },
    leaveGame: (parent, args, context, info) => {
      return new Promise(async (resolve, reject) => {
        const game = gameCache[args.gameHash];
        if (!game) {
          return resolve(false);
        }
        game.playerLeaveGame(args.userHash);
        return resolve(true);
      });
    },
    sendEvent: (parent, args, context, info) => {
      const game = gameCache[args.gameHash];
      if (!game) {
        return false;
      }
      return game.userEvent(args.event, args.userHash);
    },
  },

  Timestamp,
};

module.exports = resolvers;
