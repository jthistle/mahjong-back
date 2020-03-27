const crypto = require('crypto');
const db = require('./database.js');
const config = require('./config.js');

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
          console.log('invalid user hash');
          return resolve(null);
        }
        db.query(
          'SELECT hash, players FROM games WHERE joinCode = ? AND stage != 0',
          [args.gameCode],
          (error, results) => {
            if (results.length !== 1) {
              console.log('game not found');
              return resolve(null);
            }

            /* Add player to list of players */
            const game = results[0];
            const players = JSON.parse(game.players);
            if (players.length >= config.maxPlayers) {
              /* TODO allow join to spectate? */
              console.log('too many players');
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
