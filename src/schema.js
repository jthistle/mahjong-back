const { gql } = require('apollo-server-express');

const typeDefs = gql`
  scalar Timestamp

  type Query {
    hello: String
    "Get information about a given user"
    user(userHash: String!): User
    "Get meta information about a game"
    game(userHash: String!, gameHash: String!): Game
    "Gets game events"
    events(userHash: String!, gameHash: String!, offset: Int!): EventsResponse
  }

  type Mutation {
    "Create a user, returns user hash"
    createUser(nickname: String!): String!
    "Create a new game, returns a game hash"
    createGame(userHash: String!): String!
    "Join an existing game, returns game hash"
    joinGame(userHash: String!, gameCode: String!): String
    "Attempt to send an event to the server, returns success"
    sendEvent(
      event: EventInput!
      userHash: String!
      gameCode: String!
    ): Boolean!
  }

  type User {
    hash: String!
    inGame: String
    nickname: String!
  }

  enum GameStage {
    FINISHED
    PREGAME
    PLAY
  }

  "Players are referred to by index, starting at 0"
  type Game {
    joinCode: String!
    nicknames: [String!]!
    stage: GameStage!
    myPosition: Int
  }

  enum Suit {
    CIRCLES
    BAMBOO
    CHARACTERS
    WINDS
    DRAGONS
    FLOWERS
    SEASONS
  }

  "A single tile"
  type Tile {
    "Coding for values: RGW are 123 respectively, ESWN are 1234"
    value: Int!
    suit: Suit!
  }

  "A valid combination of tiles e.g. pung"
  type TileSet {
    tiles: [Tile!]!
    "TODO: concealed"
    concealed: Boolean
  }

  enum EventType {
    "The round has started"
    ROUND_START
    "Set the east player, uses player"
    SET_EAST
    "Start a player's turn, uses player"
    START_TURN
    "A piece is picked up from the wall, uses tile, player"
    PICKUP_WALL
    "The last discard is picked up from the table, uses tile, player"
    PICKUP_TABLE
    "A piece is discarded to the table, uses tile, player"
    DISCARD
    "A combo is declared, uses tileSet, player"
    DECLARE
    "A player goes mahjong, uses player"
    MAHJONG
    "The round has ended"
    ROUND_END
    "The game finishes"
    GAME_END
  }

  type Event {
    type: EventType!
    time: Timestamp!
    tile: Tile
    tileSet: TileSet
    player: Int
  }

  type EventsResponse {
    offset: Int!
    events: [Event!]!
  }

  input EventInput {
    type: EventType!
    tile: TileInput
    tileSet: TileSetInput
  }

  input TileInput {
    value: Int!
    suit: Suit!
  }

  input TileSetInput {
    tiles: [TileInput!]!
    concealed: Boolean
  }
`;

module.exports = typeDefs;
