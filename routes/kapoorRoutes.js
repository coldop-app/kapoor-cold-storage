
import {
  testController,
} from "../controllers/store-adminDayBookController.js";
import { quickRegisterFarmer, getAllFarmerProfiles, getAccountsForFarmerProfile, searchFarmerProfiles, createIncomingOrder } from "../controllers/kapoor-auth-controller.js";
import { storeAdminProtect } from "../middleware/authMiddleware.js";

function kapoorRoutes(fastify, options, done) {

  fastify.get("/test", testController);

  fastify.post("/quick-register", { preHandler: [storeAdminProtect] }, quickRegisterFarmer )

  fastify.get("/farmer-profiles", getAllFarmerProfiles);
  fastify.get("/farmer-profiles/:profileId/accounts", getAccountsForFarmerProfile);
  fastify.get("/farmer-profiles/search", searchFarmerProfiles);

  // Incoming order routes
  fastify.post("/incoming-orders", { preHandler: [storeAdminProtect] }, createIncomingOrder);

  done();
}

export default kapoorRoutes;
