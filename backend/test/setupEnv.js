require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test_super_secret_jwt_key_for_unit_tests_only";
process.env.MONGO_URL = "mongodb://127.0.0.1:27017/ratingdb_test";
jest.setTimeout(30000);
