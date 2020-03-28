const { gql } = require('apollo-server-express');

const typeDefs = gql`
  type Query {
    hello: String
    "Get information about a given user"
    user(userHash: String!): User
    "Get initial information about a game"
    game(userHash: String!, gameHash: String!): Game
  }

  type Mutation {
    "Create a user, returns user hash"
    createUser(nickname: String!): String!
    "Create a new game, returns a game hash"
    createGame(userHash: String!): String!
    "Join an existing game, returns game hash"
    joinGame(userHash: String!, gameCode: String!): String
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

  enum Suit {
    CIRCLES
    BAMBOO
    CHARACTERS
    WINDS
    DRAGONS
    FLOWERS
    SEASONS
  }

  type Tile {
    "Coding for values: RGW are 123 respectively, ESWN are 1234"
    value: Int!
    suit: Suit!
  }

  "A valid combination of tiles e.g. pung"
  type TileSet {
    tiles: [Tile!]!
  }

  "Players are referred to by index, starting at 0"
  type Game {
    joinCode: String!
    nicknames: [String!]!
    stage: GameStage!
    turn: Int
    east: Int
    "An array of revealed tile sets for each player"
    declaredTiles: [[TileSet!]!]
    "Each player's own hidden tilse"
    playerTiles: [[Tile!]!]
    "Each player's discarded tiles"
    discardTiles: [[Tile!]!]
    myPosition: Int
    startTime: Int
  }
`;

module.exports = typeDefs;
