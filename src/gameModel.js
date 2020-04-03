const cloneDeep = require('clone-deep');

const db = require('./database.js');
const config = require('./config.js');
const { TURN_STATE, EVENT } = require('./const.js');

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

/**
 * Helper function. Moves a tile from source array to a destination array.
 */
function moveTile(src, dest, tile) {
  let ind = null;
  src.some((srcTile, i) => {
    if (srcTile.suit === tile.suit && srcTile.value === tile.value) {
      ind = i;
      return true;
    }
    return false;
  });

  if (ind === null) {
    console.error("Can't find tile in source tiles!");
    return false;
  }

  dest.push(src[ind]);
  src.splice(ind, 1);
  return true;
}

/**
 * The game model handles caching game state, processing the event queue,
 * writing events to the database, validating user events, and starting new
 * turns and games.
 */
function game(_hash, _players, _events) {
  const hash = _hash;
  let locked = false;
  const events = _events ? cloneDeep(_events) : [];
  let lastEventId = -1;
  let east = 0;
  let turn = 0;
  let turnState = null;
  const players = cloneDeep(_players);
  const wallTiles = [];
  const hiddenTiles = [];
  const discardTiles = [];
  const declaredTiles = [];

  for (let i = 0; i < players.length; ++i) {
    declaredTiles.push([]);
  }

  const playerId = (hash) => players.indexOf(hash);

  /**
   * Tile comparison functions.
   */
  const areSameSuit = (...tiles) => {
    for (let i = 1; i < tiles.length; ++i) {
      if (tiles[i].suit !== tiles[i - 1].suit) {
        return false;
      }
    }
    return true;
  };

  const areSameTile = (...tiles) => {
    for (let i = 1; i < tiles.length; ++i) {
      if (
        tiles[i].value !== tiles[i - 1].value ||
        tiles[i].suit !== tiles[i - 1].suit
      ) {
        return false;
      }
    }
    return true;
  };

  const areInRow = (...tiles) => {
    tiles.sort((a, b) => {
      return a.value - b.value;
    });
    let last = tiles[0].value;
    for (let i = 1; i < tiles.length; ++i) {
      if (tiles[i].value !== last + 1) {
        return false;
      }
      last += 1;
    }
    return true;
  };

  /**
   * Simple linear search for a tile in a tileset.
   */
  const tileInSet = (tile, set) => {
    for (let i = 0; i < set.length; ++i) {
      if (areSameTile(set[i], tile)) {
        return true;
      }
    }
    return false;
  };

  /**
   * Counts the occurences of `tile` in `set`.
   */
  const countTilesInSet = (tile, set) => {
    let count = 0;
    for (let i = 0; i < set.length; ++i) {
      if (areSameTile(set[i], tile)) {
        count += 1;
      }
    }
    return count;
  };

  /**
   * Gets the chosen suit in a declared set.
   */
  const chosenSuit = (declared) => {
    let suit = null;
    for (let i = 0; i < declared.length; ++i) {
      for (let j = 0; j < declared[i].length; ++j) {
        if (
          !['CIRCLES', 'BAMBOO', 'CHARACTERS'].includes(declared[i][j].suit)
        ) {
          continue;
        }
        if (suit === null) {
          suit = declared[i][j].suit;
        }
        if (declared[i][j].suit !== suit) {
          /* mixed hand, TODO handle */
          return null;
        }
      }
    }
    return suit;
  };

  /**
   * Check if a declared hand has a chow in it.
   */
  const alreadyHasChow = (declared) => {
    return declared.some((tileSet) => {
      return tileSet[0].value !== tileSet[1].value;
    });
  };

  /**
   * Carry out the internal workings of an event, e.g. updating wallTiles or hiddenTiles
   * arrays.
   */
  const processEvent = (event) => {
    switch (event.type) {
      case EVENT.setEast:
        east = event.player;
        break;
      case EVENT.startTurn:
        turn = event.player;
        turnState = TURN_STATE.waitingForDiscard;
        break;
      case EVENT.pickupWall:
        moveTile(wallTiles, hiddenTiles[event.player], event.tile);
        break;
      case EVENT.pickupTable:
        moveTile(discardTiles, hiddenTiles[event.player], event.tile);
        break;
      case EVENT.discard:
        moveTile(hiddenTiles[event.player], discardTiles, event.tile);
        turnState = TURN_STATE.waitingForClaims;
        break;
      case EVENT.declare:
        tempTileSet = [];
        event.tileSet.tiles.forEach((tile) => {
          moveTile(hiddenTiles[event.player], tempTileSet, tile);
        });
        declaredTiles[event.player].push(tempTileSet);
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

        const result = func(...args);

        updateDatabase(() => {
          resolve(result);
        });
      });
    };
  };

  /**
   * Start a player's turn. `player` should be a player index.
   */
  const startTurn = (player) => {
    if (wallTiles.length === 0) {
      addEvent({
        type: EVENT.gameEnd,
        time: Date.now(),
      });
      return;
    }

    addEvent({
      type: EVENT.startTurn,
      time: Date.now(),
      player,
    });

    addEvent({
      type: EVENT.pickupWall,
      time: Date.now(),
      player,
      tile: wallTiles[0],
    });
  };

  /**
   * Determine whether a user event can be validly accepted, and, if it can,
   * add it to the events list.
   */
  const userEvent = (event, userHash) => {
    const playerInd = playerId(userHash);
    if (playerInd === -1) {
      return false;
    }
    switch (event.type) {
      /**
       * Pickup from the table requires a tile set to specify what combination exactly is being
       * declared, so that we can add the declare event ourselves.
       */
      case EVENT.pickupTable:
        if (!event.tile || !event.tileSet) {
          return false;
        }
        const tileSet = event.tileSet.tiles;
        /* A player cannot pickup from the table having just discarded */
        if (turn === playerInd) {
          return false;
        }
        /* We must be waiting for claims in the first place */
        if (turnState !== TURN_STATE.waitingForClaims) {
          return false;
        }
        /* Assume that last tile added to discards will be the last one in the array */
        if (!areSameTile(event.tile, discardTiles[discardTiles.length - 1])) {
          return false;
        }
        /* The tile picked up must fit into the declared set */
        if (!tileInSet(event.tile, tileSet)) {
          return false;
        }
        /* The tile set being declared must be a pung, kong, or chow */
        if (
          !(
            areSameTile(...tileSet) &&
            (tileSet.length === 3 || tileSet.length === 4)
          ) &&
          !(
            areSameSuit(...tileSet) &&
            areInRow(...tileSet) &&
            tileSet.length === 3 &&
            playerInd === (turn + 1) % players.length &&
            !alreadyHasChow(declaredTiles[playerInd])
          )
        ) {
          return false;
        }
        /**
         * The tile being picked up must have the same suit as any declared tiles, except
         * in some special hands (TODO).
         */
        const chosen = chosenSuit(declaredTiles[playerInd]);
        if (chosen !== null && chosen !== event.tile.suit) {
          return false;
        }

        const declaredSet = cloneDeep(event.tileSet);
        declaredSet.tiles.sort((a, b) => a.value - b.value);

        addEvent({
          type: EVENT.pickupTable,
          time: Date.now(),
          player: playerInd,
          tile: {
            ...event.tile,
          },
        });
        addEvent({
          type: EVENT.declare,
          time: Date.now(),
          player: playerInd,
          tileSet: declaredSet,
        });

        if (event.tileSet.length === 4) {
          /* Kong, player must pick up again before discarding */
          startTurn(playerInd);
        } else {
          /* Otherwise, a simple discard is needed */
          addEvent({
            type: EVENT.startTurn,
            time: Date.now(),
            player: playerInd,
          });
        }
        return true;
      /**
       * A discard is a lot simpler to validate.
       */
      case EVENT.discard:
        if (!event.tile) {
          return false;
        }
        if (turn !== playerInd) {
          return false;
        }
        if (turnState !== TURN_STATE.waitingForDiscard) {
          return false;
        }
        if (!tileInSet(event.tile, hiddenTiles[playerInd])) {
          return false;
        }
        addEvent({
          type: EVENT.discard,
          time: Date.now(),
          player: playerInd,
          tile: {
            ...event.tile,
          },
        });
        return true;
      case EVENT.mahjong:
        // TODO
        return true;
      default:
        /* Most event types cannot be sent by the user */
        return false;
    }
  };

  /**
   * Move on to the next turn of the game.
   */
  const nextTurn = () => {
    if (turnState !== TURN_STATE.waitingForClaims) {
      return;
    }
    let newTurn = turn + 1;
    if (newTurn >= players.length) {
      newTurn = 0;
    }
    startTurn(newTurn);
  };

  /**
   * Start a game. We need to deal 13 tiles for each player, then select a player
   * to go first (i.e. be East).
   */
  const initNew = () => {
    addEvent({
      type: EVENT.roundStart,
      time: Date.now(),
    });

    for (let i = 0; i < config.maxPlayers; ++i) {
      for (let j = 0; j < 13; ++j) {
        addEvent({
          type: EVENT.pickupWall,
          time: Date.now(),
          player: i,
          tile: wallTiles[i * 13 + j],
        });
      }
    }

    addEvent({
      type: EVENT.setEast,
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
    for (let i = 1; i <= 9; ++i) {
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
    hash: () => hash,
    locked: () => locked,
    lastEventId: () => lastEventId,
    playerId,
    addPlayer: (hash) => {
      players.length < config.maxPlayers && players.push(hash);
    },
    forEachEvent: (callback) => events.forEach(callback),
    addEvent: wrapExternal(addEvent),
    initNew: wrapExternal(initNew),
    nextTurn: wrapExternal(nextTurn),
    userEvent: wrapExternal(userEvent),
    timeSinceLastEvent: () => Date.now() - events[events.length - 1].time,
    turnState: () => turnState,
  };
}

module.exports = game;
