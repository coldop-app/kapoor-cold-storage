import { testController } from "../controllers/store-adminDayBookController.js";
import {
  quickRegisterFarmer,
  getFarmersIdsForCheck,
  getAllFarmerProfiles,
  getKapoorDaybookOrders,
  getAccountsForFarmerProfile,
  searchFarmerProfiles,
  createIncomingOrder,
  editKapoorIncomingOrder,
  getReceiptVoucherNumbers,
  getAllIncomingOrdersOfASingleFarmer,
  getKapoorColdStorageSummary,
  getAllOrdersOfASingleFarmer,
  getKapoorTopFarmers,
  searchKapoorOrdersByVariety,
  createOutgoingOrder,
  getFarmerStockSummary,
  searchOrderByReceiptNumber,
} from "../controllers/kapoor-auth-controller.js";
import { storeAdminProtect } from "../middleware/authMiddleware.js";

function kapoorRoutes(fastify, options, done) {
  fastify.get("/test", testController);

  fastify.post(
    "/quick-register",
    { preHandler: [storeAdminProtect] },
    quickRegisterFarmer
  );

  // Get all used farmer IDs for this cold storage
  fastify.get(
    "/farmer-ids",
    { preHandler: [storeAdminProtect] },
    getFarmersIdsForCheck
  );

  fastify.get(
    "/farmer-profiles",
    { preHandler: [storeAdminProtect] },
    getAllFarmerProfiles
  );
  fastify.get(
    "/farmer-profiles/:profileId/accounts",
    { preHandler: [storeAdminProtect] },
    getAccountsForFarmerProfile
  );
  fastify.get(
    "/farmer-profiles/search",
    { preHandler: [storeAdminProtect] },
    searchFarmerProfiles
  );

  // Incoming order routes
  fastify.post(
    "/incoming-orders",
    { preHandler: [storeAdminProtect] },
    createIncomingOrder
  );

  // Edit incoming order route
  fastify.put(
    "/incoming-orders/:id",
    { preHandler: [storeAdminProtect] },
    editKapoorIncomingOrder
  );

  // Get receipt voucher numbers for this cold storage
  fastify.get(
    "/receipt-voucher-numbers",
    { preHandler: [storeAdminProtect] },
    getReceiptVoucherNumbers
  );

  // Get kapoor incoming orders with pagination and sorting
  fastify.get(
    "/daybook-orders",
    { preHandler: [storeAdminProtect] },
    getKapoorDaybookOrders
  );

  // Get all incoming orders for a single farmer (by FarmerAccount IDs)
  fastify.post(
    "/incoming-orders/single-farmer",
    { preHandler: [storeAdminProtect] },
    getAllIncomingOrdersOfASingleFarmer
  );

  // Get all incoming orders for a single farmer (by FarmerAccount IDs)
  fastify.post(
    "/all-orders/single-farmer",
    { preHandler: [storeAdminProtect] },
    getAllOrdersOfASingleFarmer
  );

  fastify.post(
    "/outgoing-orders/:id",
    { preHandler: [storeAdminProtect] },
    createOutgoingOrder
  );

  fastify.get(
    "/cold-storage-summary",
    { preHandler: [storeAdminProtect] },
    getKapoorColdStorageSummary
  );

  fastify.get(
    "/top-farmers",
    { preHandler: [storeAdminProtect] },
    getKapoorTopFarmers
  );

  fastify.post(
    "/search-orders",
    { preHandler: [storeAdminProtect] },
    searchKapoorOrdersByVariety
  );

  // Get farmer stock summary
  fastify.post(
    "/farmer-stock-summary",
    { preHandler: [storeAdminProtect] },
    getFarmerStockSummary
  );

  // Search orders by receipt number
  fastify.post(
    "/search-by-receipt",
    { preHandler: [storeAdminProtect] },
    searchOrderByReceiptNumber
  );

  done();
}

export default kapoorRoutes;
