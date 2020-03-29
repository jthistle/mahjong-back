const cloneDeep = require('clone-deep');

const db = require('./database.js');
const config = require('./config.js');

/**
 * Shuffles array in place.
 * Thanks to https://stackoverflow.com/questions/6274339/how-can-i-shuffle-an-array.
 * @param {Array} a items An array containing the items.
 */
function shuffle(a) {
  var j, x, i;
  for (i = a.length - 1; i > 0; i--) {
    j = Math.floor(Math.random() * (i + 1));
    x = a[i];
    a[i] = a[j];
    a[j] = x;
  }
  return a;
}

function moveTile(src, dest, tile) {
  let ind = null;
  src.some((srcTile, i) => {
    if (srcTile.suit === tile.suit && srcTile.value === tile.value) {
      ind = i;
      return true;
    }
  });

  if (ind === null) {
    console.error("Can't find tile in source tiles!");
    return false;
  }

  dest.push(src[ind]);
  src.splice(ind, 1);
  return true;
}

function game(_hash, _players, _events) {
  const hash = _hash;
  let locked = false;
  const events = _events ? cloneDeep(_events) : [];
  let lastEventId = -1;
  let east = 0;
  let turn = 0;
  const players = cloneDeep(_players);
  const wallTiles = [];
  const hiddenTiles = [];
  const discardTiles = [];
  const declaredTiles = [];

  /**
   * Carry out the internal workings of an event, e.g. updating wallTiles or hiddenTiles
   * arrays, and doing business logic.
   */
  const processEvent = (event) => {
    switch (event.type) {
      case 'SET_EAST':
        east = event.player;
        break;
      case 'START_TURN':
        turn = event.player;
        break;
      case 'PICKUP_WALL':
        moveTile(wallTiles, hiddenTiles[event.player], event.tile);
        break;
      case 'PICKUP_TABLE':
        moveTile(discardTiles, hiddenTiles[event.player], event.tile);
        break;
      case 'DISCARD':
        moveTile(hiddenTiles[event.player], discardTiles, event.tile);
        break;
      case 'DECLARE':
        tempTileSet = [];
        event.tileSet.forEach((tile) => {
          moveTile(hiddenTiles[event.player], tempTileSet, tile);
        });
        declaredTiles.push(tempTileSet);
        break;
    }
  };

  /**
   * Add an event to the list of events
   */
  const addEvent = (event) => {
    events.push(cloneDeep(event));
    lastEventId += 1;
    processEvent(event);
  };

  /**
   * Update the database with the current events array.
   */
  const updateDatabase = (callback) => {
    db.query(
      'UPDATE games SET events = ? WHERE hash = ?',
      [JSON.stringify(events), hash],
      (error, results) => {
        locked = false;
        if (callback) callback();
      }
    );
  };

  /**
   * Wraps a function which changes the events log to make it thread-safe for external
   * access.
   */
  const wrapExternal = (func) => {
    return (...args) => {
      return new Promise((resolve) => {
        if (locked) return resolve(false);
        locked = true;

        func(...args);

        updateDatabase(() => {
          resolve(true);
        });
      });
    };
  };

  const startTurn = (player) => {
    if (wallTiles.length === 0) {
      addEvent({
        type: 'GAME_END',
        time: Date.now(),
      });
      return;
    }

    addEvent({
      type: 'START_TURN',
      time: Date.now(),
      player,
    });

    addEvent({
      type: 'PICKUP_WALL',
      time: Date.now(),
      player,
      tile: wallTiles[0],
    });
  };

  /**
   * Start a game. We need to deal 13 tiles for each player, then select a player
   * to go first (i.e. be East).
   */
  const initNew = () => {
    addEvent({
      type: 'ROUND_START',
      time: Date.now(),
    });

    for (let i = 0; i < config.maxPlayers; ++i) {
      for (let j = 0; j < 13; ++j) {
        addEvent({
          type: 'PICKUP_WALL',
          time: Date.now(),
          player: i,
          tile: wallTiles[i * 13 + j],
        });
      }
    }

    addEvent({
      type: 'SET_EAST',
      time: Date.now(),
      player: Math.floor(Math.random() * 4),
    });

    startTurn(east);

    updateDatabase();
  };

  /**
   * Construct. Begin by initing wall, then read events if any.
   */
  for (let i = 0; i < config.maxPlayers; ++i) {
    hiddenTiles.push([]);
  }

  ['CIRCLES', 'BAMBOO', 'CHARACTERS'].forEach((suit, i) => {
    for (let i = 1; i <= 10; ++i) {
      for (let j = 1; j <= 4; ++j) {
        wallTiles.push({
          suit,
          value: i,
        });
      }
    }
  });

  for (let i = 1; i <= 4; ++i) {
    for (let j = 1; j <= 4; ++j) {
      wallTiles.push({
        suit: 'WINDS',
        value: i,
      });
    }
  }

  for (let i = 1; i <= 3; ++i) {
    for (let j = 1; j <= 4; ++j) {
      wallTiles.push({
        suit: 'DRAGONS',
        value: i,
      });
    }
  }

  shuffle(wallTiles);

  if (events.length !== 0) {
    events.forEach((ev) => processEvent(ev));
    lastEventId = events.length - 1;
    updateDatabase();
  }

  return {
    locked: () => locked,
    hash: () => hash,
    lastEventId: () => lastEventId,
    playerId: (hash) => players.indexOf(hash),
    addPlayer: (hash) => {
      players.length < config.maxPlayers && players.push(hash);
    },
    forEachEvent: (callback) => events.forEach(callback),
    addEvent: wrapExternal(addEvent),
    initNew: wrapExternal(initNew),
    startTurn: wrapExternal(startTurn),
  };
}

module.exports = game;
