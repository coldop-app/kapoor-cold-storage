
import {
  testController,
} from "../controllers/store-adminDayBookController.js";
import { quickRegisterFarmer, getFarmersIdsForCheck, getAllFarmerProfiles, getAccountsForFarmerProfile, searchFarmerProfiles, createIncomingOrder, getReceiptVoucherNumbers, getKapoorIncomingOrders, getAllIncomingOrdersOfASingleFarmer } from "../controllers/kapoor-auth-controller.js";
import { storeAdminProtect } from "../middleware/authMiddleware.js";

function kapoorRoutes(fastify, options, done) {

  fastify.get("/test", testController);

  fastify.post("/quick-register", { preHandler: [storeAdminProtect] }, quickRegisterFarmer )

  // Get all used farmer IDs for this cold storage
  fastify.get("/farmer-ids", { preHandler: [storeAdminProtect] }, getFarmersIdsForCheck);

  fastify.get("/farmer-profiles", { preHandler: [storeAdminProtect] }, getAllFarmerProfiles);
  fastify.get("/farmer-profiles/:profileId/accounts", { preHandler: [storeAdminProtect] }, getAccountsForFarmerProfile);
  fastify.get("/farmer-profiles/search", { preHandler: [storeAdminProtect] }, searchFarmerProfiles);

  // Incoming order routes
  fastify.post("/incoming-orders", { preHandler: [storeAdminProtect] }, createIncomingOrder);

  // Get receipt voucher numbers for this cold storage
  fastify.get("/receipt-voucher-numbers", { preHandler: [storeAdminProtect] }, getReceiptVoucherNumbers);

  // Get kapoor incoming orders with pagination and sorting
  fastify.get("/incoming-orders", { preHandler: [storeAdminProtect] }, getKapoorIncomingOrders);

  // Get all incoming orders for a single farmer (by FarmerAccount IDs)
  fastify.post("/incoming-orders/single-farmer", { preHandler: [storeAdminProtect] }, getAllIncomingOrdersOfASingleFarmer);

  done();
}

export default kapoorRoutes;
