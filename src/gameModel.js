const cloneDeep = require('clone-deep');

const db = require('./database.js');
const config = require('./config.js');
const {
  TURN_STATE,
  EVENT,
  GAME_STAGE,
  GAME_STAGE_TO_INT,
} = require('./const.js');

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
    console.error("Can't find tile", tile, 'in source tiles!');
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
function game(_hash, _players, _gameStage, _events) {
  const hash = _hash;
  let locked = false;
  let events = _events ? cloneDeep(_events) : [];
  let lastEventId = -1;
  let east = -1;
  let turn = 0;
  let turnState = null;
  let gameStage = _gameStage;
  const players = cloneDeep(_players);
  let readyPlayers = Array(players.length).fill(false);
  let wallTiles = [];
  let hiddenTiles = [];
  let discardTiles = [];
  let declaredTiles = [];

  const playerId = (hash) => players.indexOf(hash);

  /**
   * Let a player leave the game, by ending it.
   */
  const playerLeaveGame = (playerHash) => {
    addEvent({
      type: EVENT.gameEnd,
      time: Date.now(),
      extra: 'A player left the game',
    });
    updateDatabase();
  };

  /**
   * Set whether a player is ready to begin a new round.
   */
  const playerSetReady = (playerHash, isReady) => {
    if (players.indexOf(playerHash) !== -1) {
      readyPlayers[players.indexOf(playerHash)] = isReady;
      return true;
    }
    return false;
  };

  /**
   * Returns whether all players are ready for a new round to begin.
   */
  const playersReady = () => {
    return readyPlayers.every((ready) => ready);
  };

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
      case EVENT.roundStart:
        gameStage = GAME_STAGE.play;
        break;
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
      case EVENT.roundEnd:
        /* Return to pregame once a round has ended */
        gameStage = GAME_STAGE.pregame;
        break;
      case EVENT.gameEnd:
        gameStage = GAME_STAGE.finished;
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
   * Helper function for declaring a combo.
   */
  const declareCombo = (tiles, player, concealed = false) => {
    addEvent({
      type: EVENT.declare,
      time: Date.now(),
      player,
      tileSet: {
        tiles,
        concealed,
      },
    });
  };

  /**
   * Update the database with the current events array and game stage.
   */
  const updateDatabase = (callback) => {
    db.query(
      'UPDATE games SET stage = ?, events = ? WHERE hash = ?',
      [GAME_STAGE_TO_INT[gameStage], JSON.stringify(events), hash],
      (error, results) => {
        locked = false;
        if (callback) callback();
      }
    );
  };

  /**
   * Wraps a function which changes the events log to make it thread-safe for external
   * access. Any function wrapped in this will:
   *   - not be run if the game mutex is locked
   *   - return a promise
   *   - resolve only after the events array has be written to the database
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
   * Finds pungs and kongs in a player's hidden tiles.
   */
  const findPungsKongs = (player) => {
    const tiles = hiddenTiles[player];
    const pungs = [];
    const kongs = [];
    for (let i = 0; i < tiles.length - 3; ++i) {
      let count = 0;
      for (let j = i + 1; j < tiles.length; ++j) {
        if (areSameTile(tiles[i], tiles[j])) {
          count += 1;
          if (count === 4) {
            break;
          }
        }
      }
      if (count === 3 || count === 4) {
        const modArray = count === 3 ? pungs : kongs;
        if (modArray.some((tile) => areSameTile(tile, tiles[i]))) {
          continue;
        }
        modArray.push(tiles[i]);
      }
    }
    return {
      pungs,
      kongs,
    };
  };

  /**
   * Pickup from the wall, if possible.
   */
  const doPickup = (player) => {
    if (wallTiles.length === 0) {
      addEvent({
        type: EVENT.roundEnd,
        time: Date.now(),
      });
      return;
    }

    addEvent({
      type: EVENT.pickupWall,
      time: Date.now(),
      player,
      tile: wallTiles[0],
    });

    checkKongs(player);
  };

  /**
   * Checks a player's hand for kongs, declaring them if found, and picking up.
   */
  const checkKongs = (player) => {
    const { kongs } = findPungsKongs(player);

    if (kongs.length === 0) {
      return;
    }

    const suit = chosenSuit(declaredTiles[player]);
    let ind = -1;
    if (suit !== null) {
      for (let i = 0; i < kongs.length; ++i) {
        if (kongs[i].suit === suit) {
          ind = i;
          break;
        }
      }
      /* There isn't a kong in the right suit to declare, so end. */
      if (ind === -1) {
        return;
      }
    } else {
      ind = 0;
    }

    declareCombo(Array(4).fill({ ...kongs[ind] }), player, true);

    doPickup(player);
  };

  /**
   * Checks for a chow and a pair in the tiles array passed. Returns the pair
   * and the chow.
   */
  const checkChowAndPair = (tiles) => {
    const tempTiles = cloneDeep(tiles);
    let pairedTile = null;
    for (let i = 0; i < tempTiles.length - 1; ++i) {
      for (let j = i + 1; j < tempTiles; ++j) {
        if (areSameTile(tempTiles[i], tempTiles[j])) {
          pairedTile = tempTiles[j];
          tempTiles.splice(j, 1);
          tempTiles.splice(i, 1);
          break;
        }
      }
    }
    if (pairedTile !== null && areInRow(...tempTiles)) {
      tempTiles.sort((a, b) => a.value - b.value);
      const pair = Array(2).fill(pairedTile);
      return {
        pair,
        chow: tempTiles,
      };
    }
    return false;
  };

  /**
   * Check a player's declared and hidden tiles for a mahjong.
   */
  const checkMahjong = (player, usingDiscard) => {
    console.log('checking mahjong');
    const chosen = chosenSuit(declaredTiles[player]);
    const remaining = cloneDeep(hiddenTiles[player]);
    const checkable = ['BAMBOO', 'CHARACTERS', 'CIRCLES'];
    const sameSuit = remaining.every(
      (tile) => !checkable.includes(tile.suit) || tile.suit === chosen
    );

    /**
     * When declaring a the tile sets for a mahjong, pickupLastPiece must be
     * called before any calls to declareCombo.
     */
    let pickupLastPiece = () => {};
    if (usingDiscard) {
      remaining.push({ ...discardTiles[discardTiles.length - 1] });
      pickupLastPiece = () =>
        addEvent({
          type: EVENT.pickupTable,
          time: Date.now(),
          player,
          tile: { ...discardTiles[discardTiles.length - 1] },
        });
    }

    const declaredChow = declaredTiles[player].some((tileSet) => {
      return areInRow(...tileSet);
    });

    /**
     * If they're the same suit, we can check for:
     *   - a standard hand: this comprises pungs/kongs and optionally a single chow, all of the same
     *     suit, optionally plus pungs/kongs of winds and/or dragons, plus a single pair of the same suit
     *     as the rest of the hand.
     */
    if (sameSuit) {
      if (remaining.length === 5 && !declaredChow) {
        /**
         * Special case: check for a chow and a pair. We need to do this in case there is
         * a hand like 1BA 1BA 1BA 2BA 3BA, which would have the 'pung' taken out of it by
         * the following algorithm.
         */
        const result = checkChowAndPair(remaining);
        if (result) {
          console.log('yes 1');
          pickupLastPiece();
          declareCombo(result.pair, player);
          declareCombo(result.chow, player);
          return true;
        }
      }
      /* First check for pungs in the hidden hand (all kongs should have already been declared) */
      const { pungs } = findPungsKongs(player);
      pungs.forEach((pungedTile) => {
        const toSplice = [];
        remaining.forEach((tile, i) => {
          if (areSameTile(tile, pungedTile)) {
            toSplice.push(i);
          }
        });
        /* reverse */
        toSplice.sort((a, b) => b - a);
        toSplice.forEach((ind) => {
          remaining.splice(ind, 1);
        });
      });
      /* Now we've gotten rid of punged tiles, check for a pair (and possibly a chow) */
      if (remaining.length === 5) {
        if (declaredChow) {
          console.log('no 1');
          /* Can't have more than one chow */
          return false;
        }
        const result = checkChowAndPair(remaining);
        if (result) {
          console.log('yes 2');
          pickupLastPiece();
          pungs.forEach((pungedTile) => {
            declareCombo(Array(3).fill(pungedTile), player, true);
          });
          declareCombo(result.pair, player);
          declareCombo(result.chow, player);
          return true;
        }
      } else if (remaining.length === 2) {
        if (areSameTile(...remaining)) {
          console.log('yes 3');
          pickupLastPiece();
          declareCombo(remaining, player);
          return true;
        }
      } else {
        /**
         * TODO special hands
         */
      }
    }
    console.log('no end');
    return false;
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
        if (
          chosen !== null &&
          chosen !== event.tile.suit &&
          ['BAMBOO', 'CIRCLES', 'CHARACTERS'].includes(event.tile.suit)
        ) {
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

        if (tileSet.length === 4) {
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
      /**
       * Most mahjong event checking is done in `checkMahjong`.
       */
      case EVENT.mahjong:
        let result = false;
        if (turn === playerInd && turnState === TURN_STATE.waitingForDiscard) {
          result = checkMahjong(playerInd, false);
        } else if (
          turn !== playerInd &&
          turnState === TURN_STATE.waitingForClaims
        ) {
          result = checkMahjong(playerInd, true);
        }
        if (result) {
          addEvent({
            type: EVENT.mahjong,
            player: playerInd,
            time: Date.now(),
          });
          addEvent({
            type: EVENT.roundEnd,
            time: Date.now(),
          });
          return true;
        }
        return false;
      default:
        /* Most event types cannot be sent by the user */
        return false;
    }
  };

  /**
   * Start a player's turn. `player` should be a player index.
   */
  const startTurn = (player) => {
    addEvent({
      type: EVENT.startTurn,
      time: Date.now(),
      player,
    });

    doPickup(player);
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
   * Starts a new game round. We need to deal 13 tiles for each player, then select a player
   * to go first (i.e. be East).
   */
  const newRound = () => {
    events = [];
    lastEventId = -1;
    wallTiles = [];
    hiddenTiles = [];
    discardTiles = [];
    declaredTiles = [];
    readyPlayers = Array(players.length).fill(false);

    initWall();

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
      player:
        east === -1
          ? Math.floor(Math.random() * 4)
          : (east + 1) % players.length,
    });

    startTurn(east);
  };

  /**
   * Fill the wall with tiles, and randomize.
   */
  const initWall = () => {
    for (let i = 0; i < config.maxPlayers; ++i) {
      hiddenTiles.push([]);
      declaredTiles.push([]);
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
  };

  /**
   * Contruction. Read events, if any.
   */
  if (events.length !== 0) {
    initWall();
    events.forEach((ev) => processEvent(ev));
    lastEventId = events.length - 1;
    updateDatabase();
  }

  return {
    /* Getters for private variables */
    hash: () => hash,
    locked: () => locked,
    turnState: () => turnState,
    gameStage: () => gameStage,
    /* Methods relating to events */
    forEachEvent: (callback) => events.forEach(callback),
    lastEventId: () => lastEventId,
    timeSinceLastEvent: () => Date.now() - events[events.length - 1].time,
    userEvent: wrapExternal(userEvent),
    /* Methods relating to players */
    playerId,
    addPlayer: (hash) => {
      if (players.length < config.maxPlayers) {
        players.push(hash);
        readyPlayers.push(false);
      }
    },
    playerCount: () => players.length,
    playerSetReady,
    playerLeaveGame,
    playersReady,
    /* Methods relating to game flow control, for use by game manager */
    newRound: wrapExternal(newRound),
    nextTurn: wrapExternal(nextTurn),
  };
}

module.exports = game;
