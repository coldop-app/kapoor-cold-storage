import {
  loginSchema,
  storeAdminRegisterSchema,
  storeAdminUpdateSchmea,
  quickRegisterSchema,
  farmerIdSchema,
} from "../utils/validationSchemas.js";
import bcrypt from "bcryptjs";
import FarmerProfile from "../models/farmerProfile.js";
import FarmerAccount from "../models/farmerAccount.js";
import StoreAdmin from "../models/storeAdminModel.js";
import KapoorIncomingOrder from "../models/kapoor-incoming-model.js";
import KapoorOutgoingOrder from "../models/kapoor-outgoing-order-model.js";
import mongoose from "mongoose";
import {
  getDeliveryVoucherNumberHelper,
  getReceiptNumberHelper,
  formatDate,
  formatFarmerName,
} from "../utils/helpers.js";

// Helper function to calculate current stock for KapoorIncomingOrder
const getCurrentStockForKapoor = async (coldStorageId, req) => {
  try {
    req.log.info("Calculating current stock for Kapoor helper function", {
      coldStorageId,
      requestId: req.id,
    });

    // Validate MongoDB ObjectId
    if (!mongoose.Types.ObjectId.isValid(coldStorageId)) {
      throw new Error("Invalid ID format");
    }

    // Aggregate incoming orders to sum quantities
    const result = await KapoorIncomingOrder.aggregate([
      {
        $match: {
          coldStorageId: new mongoose.Types.ObjectId(coldStorageId),
        },
      },
      { $unwind: "$incomingBagSizes" },
      {
        $group: {
          _id: null,
          totalCurrentQuantity: {
            $sum: "$incomingBagSizes.quantity.currentQuantity",
          },
        },
      },
    ]);

    return result.length > 0 ? result[0].totalCurrentQuantity : 0;
  } catch (error) {
    req.log.error("Error in calculate current stock helper for Kapoor", {
      error: error.message,
      stack: error.stack,
      coldStorageId,
      requestId: req.id,
    });
    throw error;
  }
};

const quickRegisterFarmer = async (req, reply) => {
  try {
    const storeAdminId = req.storeAdmin._id;
    quickRegisterSchema.parse(req.body);

    const {
      name,
      fatherName,
      address,
      mobileNumber,
      password,
      imageUrl,
      farmerId,
      variety,
    } = req.body;

    if (!farmerId) {
      req.log.warn("FarmerId is missing in the request body");
      return reply.code(400).send({
        status: "Fail",
        message: "FarmerId is required",
      });
    }

    const formattedName = formatFarmerName(name);

    // ✅ Step 1: Check if a FarmerProfile exists by name + fatherName
    let farmerProfile = await FarmerProfile.findOne({
      name: formattedName,
      fatherName,
    });

    // ✅ Step 2: Create profile if not exists
    if (!farmerProfile) {
      req.log.info("No existing profile found. Creating new farmer profile", {
        name: formattedName,
        fatherName,
      });

      farmerProfile = await FarmerProfile.create({
        name: formattedName,
        fatherName,
        address,
        mobileNumber,
        imageUrl,
      });
    } else {
      req.log.info("Found existing farmer profile", {
        profileId: farmerProfile._id,
        name: farmerProfile.name,
      });
    }

    // ✅ Step 3: Check if a FarmerAccount already exists for this profile + storeAdmin + variety
    const existingAccount = await FarmerAccount.findOne({
      profile: farmerProfile._id,
      storeAdmin: storeAdminId,
      variety: variety,
    });

    if (existingAccount) {
      req.log.warn(
        "Farmer account already exists for this person and variety in this store",
        {
          farmerId,
          storeAdminId,
          variety,
        }
      );

      return reply.code(400).send({
        status: "Fail",
        message:
          "Farmer account already exists for this person and variety in this store.",
      });
    }

    // ✅ Step 4: Hash password and create new FarmerAccount
    const hashedPassword = await bcrypt.hash(password, 10);
    req.log.info("Password hashed successfully");

    const farmerAccount = await FarmerAccount.create({
      profile: farmerProfile._id,
      storeAdmin: storeAdminId,
      fatherName,
      variety,
      farmerId,
      password: hashedPassword,
      isVerified: false,
    });

    // ✅ Step 5: Update store admin's registeredFarmers
    await StoreAdmin.findByIdAndUpdate(
      storeAdminId,
      { $addToSet: { registeredFarmers: farmerAccount._id } },
      { new: true }
    );

    req.log.info("Farmer registered successfully", {
      farmerId: farmerAccount.farmerId,
      storeAdminId,
    });

    return reply.code(201).send({
      status: "Success",
      message: "Farmer registered successfully",
      data: {
        _id: farmerAccount._id,
        farmerId: farmerAccount.farmerId,
        name: farmerProfile.name,
        mobileNumber: farmerProfile.mobileNumber,
      },
    });
  } catch (err) {
    req.log.error("Error occurred during farmer registration", {
      error: err.message,
    });

    return reply.code(500).send({
      status: "Fail",
      message: "Some error occurred while adding farmer",
      errorMessage: err.message,
    });
  }
};

const getFarmersIdsForCheck = async (req, reply) => {
  try {
    const storeAdminId = req.storeAdmin._id;

    // Get all farmer accounts for this store admin
    const farmerAccounts = await FarmerAccount.find({
      storeAdmin: storeAdminId,
    }).select("farmerId");

    // Extract unique farmerIds
    const usedFarmerIds = [
      ...new Set(farmerAccounts.map((account) => account.farmerId)),
    ];

    req.log.info("Retrieved farmer IDs for store admin", {
      storeAdminId,
      totalFarmers: usedFarmerIds.length,
    });

    reply.code(200).send({
      status: "Success",
      data: {
        registeredFarmers: usedFarmerIds,
      },
    });
  } catch (err) {
    req.log.error("Error occurred while fetching farmer IDs", {
      error: err.message,
    });
    reply.code(500).send({
      status: "Fail",
      message: "Failed to fetch farmer IDs",
      errorMessage: err.message,
    });
  }
};

const getAllFarmerProfiles = async (req, reply) => {
  try {
    const storeAdminId = req.storeAdmin._id;

    // Get all farmer accounts for this store admin
    const farmerAccounts = await FarmerAccount.find({
      storeAdmin: storeAdminId,
    }).select("profile");

    // Extract unique profile IDs
    const profileIds = [
      ...new Set(farmerAccounts.map((account) => account.profile)),
    ];

    // If no farmers are registered with this store admin, return empty result
    if (profileIds.length === 0) {
      return reply.code(200).send({
        status: "Success",
        data: [],
      });
    }

    // Get farmer profiles that belong to this store admin
    const profiles = await FarmerProfile.find({ _id: { $in: profileIds } });
    return reply.code(200).send({
      status: "Success",
      data: profiles,
    });
  } catch (err) {
    return reply.code(500).send({
      status: "Fail",
      message: "Failed to fetch farmer profiles",
      error: err.message,
    });
  }
};

const getAccountsForFarmerProfile = async (req, reply) => {
  try {
    const { profileId } = req.params;
    if (!profileId) {
      return reply.code(400).send({
        status: "Fail",
        message: "profileId parameter is required",
      });
    }
    const accounts = await FarmerAccount.find({ profile: profileId });
    return reply.code(200).send({
      status: "Success",
      data: accounts,
    });
  } catch (err) {
    return reply.code(500).send({
      status: "Fail",
      message: "Failed to fetch farmer accounts",
      error: err.message,
    });
  }
};

const searchFarmerProfiles = async (req, reply) => {
  try {
    const { searchQuery } = req.query;
    const storeAdminId = req.storeAdmin._id;

    if (!searchQuery || searchQuery.trim() === "") {
      return reply.code(400).send({
        status: "Fail",
        message: "Search query is required.",
      });
    }

    const trimmedQuery = searchQuery.trim();

    // First, get all farmer accounts for this store admin
    const farmerAccounts = await FarmerAccount.find({
      storeAdmin: storeAdminId,
    }).select("profile");

    // Extract unique profile IDs
    const profileIds = [
      ...new Set(farmerAccounts.map((account) => account.profile)),
    ];

    // If no farmers are registered with this store admin, return empty result
    if (profileIds.length === 0) {
      return reply.code(200).send({
        status: "Success",
        data: [],
      });
    }

    // Search farmer profiles that belong to this store admin
    const query = {
      _id: { $in: profileIds },
      $or: [
        { name: { $regex: trimmedQuery, $options: "i" } },
        { fatherName: { $regex: trimmedQuery, $options: "i" } },
        { mobileNumber: { $regex: trimmedQuery, $options: "i" } },
      ],
    };

    const profiles = await FarmerProfile.find(query);
    return reply.code(200).send({
      status: "Success",
      data: profiles,
    });
  } catch (err) {
    return reply.code(500).send({
      status: "Fail",
      message: "Failed to search farmer profiles",
      error: err.message,
    });
  }
};

const createIncomingOrder = async (req, reply) => {
  try {
    const storeAdminId = req.storeAdmin._id;

    const { farmerAccount, variety, incomingBagSizes, remarks } = req.body;

    if (!farmerAccount || !variety || !incomingBagSizes) {
      return reply.code(400).send({
        status: "Fail",
        message:
          "Missing required fields: farmerAccount, variety, incomingBagSizes",
      });
    }

    const formattedDate = new Date()
      .toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "2-digit",
        year: "2-digit",
      })
      .split("/")
      .join(".");

    const receiptNumber = await getReceiptNumberHelper(storeAdminId);

    if (!receiptNumber) {
      return reply.code(500).send({
        status: "Fail",
        message: "Failed to get RECEIPT number",
      });
    }

    if (!Array.isArray(incomingBagSizes) || incomingBagSizes.length === 0) {
      return reply.code(400).send({
        status: "Fail",
        message: "incomingBagSizes must be a non-empty array",
      });
    }

    for (const bagSize of incomingBagSizes) {
      if (
        !bagSize.size ||
        !bagSize.quantity ||
        typeof bagSize.quantity !== "object" ||
        bagSize.quantity.initialQuantity == null ||
        bagSize.quantity.currentQuantity == null ||
        typeof bagSize.quantity.initialQuantity !== "number" ||
        typeof bagSize.quantity.currentQuantity !== "number" ||
        bagSize.quantity.initialQuantity < 0 ||
        bagSize.quantity.currentQuantity < 0 ||
        !bagSize.location
      ) {
        return reply.code(400).send({
          status: "Fail",
          message:
            "Each bag size must have size, quantity (with initial and current), and location",
        });
      }
    }

    const farmerAccountDoc = await FarmerAccount.findOne({
      _id: farmerAccount,
      storeAdmin: storeAdminId,
    });

    if (!farmerAccountDoc) {
      return reply.code(404).send({
        status: "Fail",
        message: "Farmer account not found or does not belong to this store",
      });
    }

    const existingOrder = await KapoorIncomingOrder.findOne({
      coldStorageId: storeAdminId,
      "voucher.voucherNumber": receiptNumber,
    });

    if (existingOrder) {
      return reply.code(400).send({
        status: "Fail",
        message: "Voucher number already exists for this store",
      });
    }

    let existingStock;
    try {
      existingStock = await getCurrentStockForKapoor(storeAdminId, req);

      req.log.info("Calculated existing stock", {
        existingStock,
        storeAdminId,
        requestId: req.id,
      });
    } catch (error) {
      req.log.error("Error calculating existing stock", {
        error: error.message,
        storeAdminId,
        requestId: req.id,
      });
      return reply.code(500).send({
        status: "Fail",
        message: "Error calculating current stock",
        errorMessage: error.message,
      });
    }

    let additionalStock = 0;
    try {
      additionalStock = incomingBagSizes.reduce(
        (sum, bag) => sum + (bag.quantity.currentQuantity || 0),
        0
      );

      req.log.info("Calculated additional stock from current order", {
        additionalStock,
        storeAdminId,
        requestId: req.id,
      });
    } catch (error) {
      req.log.error("Error calculating additional stock", {
        error: error.message,
        storeAdminId,
        requestId: req.id,
      });
      return reply.code(500).send({
        status: "Fail",
        message: "Error calculating additional stock from current order",
        errorMessage: error.message,
      });
    }

    const currentStockAtThatTime = existingStock + additionalStock;

    // Calculate farmer-specific current stock at that time
    let farmerCurrentStockAtThatTime = 0;
    try {
      // Get the farmer profile ID from the farmer account
      const farmerProfileId = farmerAccountDoc.profile;

      // Find all previous incoming orders for this specific farmer profile
      // First get all farmer accounts for this profile
      const farmerAccounts = await FarmerAccount.find({
        profile: farmerProfileId,
        storeAdmin: storeAdminId
      }).distinct('_id');

      // Then find all previous incoming orders for these accounts
      const previousFarmerOrders = await KapoorIncomingOrder.find({
        coldStorageId: storeAdminId,
        farmerAccount: { $in: farmerAccounts }
      });

      // Calculate total current stock from all previous orders for this farmer
      const previousFarmerStock = previousFarmerOrders.reduce((total, order) => {
        const orderCurrentStock = order.incomingBagSizes.reduce((sum, bag) =>
          sum + (bag.quantity.currentQuantity || 0), 0
        );
        return total + orderCurrentStock;
      }, 0);

      // Add the current order's stock to get the running total
      farmerCurrentStockAtThatTime = previousFarmerStock + additionalStock;

      req.log.info("Farmer current stock calculation", {
        farmerProfileId,
        previousFarmerStock,
        additionalStock,
        farmerCurrentStockAtThatTime,
        storeAdminId,
        requestId: req.id,
      });
    } catch (error) {
      req.log.error("Error calculating farmer current stock", {
        error: error.message,
        storeAdminId,
        requestId: req.id,
      });
      return reply.code(500).send({
        status: "Fail",
        message: "Error calculating farmer current stock",
        errorMessage: error.message,
      });
    }

    req.log.info("Final current stock calculation", {
      existingStock,
      additionalStock,
      currentStockAtThatTime,
      storeAdminId,
      requestId: req.id,
    });

    const newIncomingOrder = await KapoorIncomingOrder.create({
      coldStorageId: storeAdminId,
      farmerAccount,
      variety,
      voucher: {
        type: "RECEIPT",
        voucherNumber: receiptNumber,
      },
      incomingBagSizes,
      dateOfEntry: formattedDate,
      remarks: remarks || "",
      createdBy: storeAdminId,
      currentStockAtThatTime,
      farmerCurrentStockAtThatTime,
    });

    req.log.info("Incoming order created successfully", {
      orderId: newIncomingOrder._id,
      storeAdminId,
      farmerAccount,
      voucherNumber: receiptNumber,
      currentStockAtThatTime,
      farmerCurrentStockAtThatTime,
    });

    return reply.code(201).send({
      status: "Success",
      message: "Incoming order created successfully",
      data: {
        _id: newIncomingOrder._id,
        coldStorageId: newIncomingOrder.coldStorageId,
        farmerAccount: newIncomingOrder.farmerAccount,
        variety: newIncomingOrder.variety,
        voucher: newIncomingOrder.voucher,
        incomingBagSizes: newIncomingOrder.incomingBagSizes,
        dateOfEntry: newIncomingOrder.dateOfEntry,
        remarks: newIncomingOrder.remarks,
        currentStockAtThatTime: newIncomingOrder.currentStockAtThatTime,
        farmerCurrentStockAtThatTime: newIncomingOrder.farmerCurrentStockAtThatTime,
        createdAt: newIncomingOrder.createdAt,
      },
    });
  } catch (err) {
    req.log.error("Error occurred during incoming order creation", {
      error: err.message,
    });

    return reply.code(500).send({
      status: "Fail",
      message: "Some error occurred while creating incoming order",
      errorMessage: err.message,
    });
  }
};

const editKapoorIncomingOrder = async (req, reply) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const orderId = req.params.id;
    const updates = req.body;
    const storeAdminId = req.storeAdmin._id;

    // Validate orderId
    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      req.log.warn("Invalid orderId provided", { orderId });
      return reply.code(400).send({
        status: "Fail",
        message: "Invalid order ID format",
      });
    }

    // Find the existing order
    const existingOrder = await KapoorIncomingOrder.findById(orderId).session(session);
    if (!existingOrder) {
      req.log.warn("Order not found", { orderId });
      return reply.code(404).send({
        status: "Fail",
        message: "Order not found",
      });
    }

    // Verify the order belongs to this store admin
    if (!existingOrder.coldStorageId.equals(storeAdminId)) {
      req.log.warn("Order does not belong to this store admin", {
        orderId,
        orderStoreId: existingOrder.coldStorageId,
        requestStoreId: storeAdminId
      });
      return reply.code(403).send({
        status: "Fail",
        message: "You can only edit orders from your own store",
      });
    }

    req.log.info("Processing incoming order update", {
      orderId,
      updates,
      requestId: req.id,
    });

    // Step 1: Handle direct field updates
    const allowedDirectUpdates = ["remarks", "dateOfEntry"];
    allowedDirectUpdates.forEach((field) => {
      if (updates[field] !== undefined) {
        existingOrder[field] = updates[field];
      }
    });

    // Step 2: Handle incomingBagSizes updates
    if (updates.incomingBagSizes && Array.isArray(updates.incomingBagSizes) && updates.incomingBagSizes.length > 0) {
      // Validate incomingBagSizes structure
      for (const bagSize of updates.incomingBagSizes) {
        if (
          !bagSize.size ||
          !bagSize.quantity ||
          typeof bagSize.quantity !== "object" ||
          bagSize.quantity.initialQuantity == null ||
          bagSize.quantity.currentQuantity == null ||
          typeof bagSize.quantity.initialQuantity !== "number" ||
          typeof bagSize.quantity.currentQuantity !== "number" ||
          bagSize.quantity.initialQuantity < 0 ||
          bagSize.quantity.currentQuantity < 0 ||
          !bagSize.location
        ) {
          throw new Error(
            "Each bag size must have size, quantity (with initial and current), and location"
          );
        }
      }

      // Filter out zero-quantity bagSizes
      const filteredBagSizes = updates.incomingBagSizes.filter(bag =>
        bag.quantity.initialQuantity > 0 || bag.quantity.currentQuantity > 0
      );

      if (filteredBagSizes.length === 0) {
        throw new Error("At least one bag size must have non-zero quantities");
      }

      existingOrder.incomingBagSizes = filteredBagSizes;
    }

    // Step 3: Handle variety update
    if (updates.variety !== undefined) {
      existingOrder.variety = updates.variety;
    }

    // Step 4: Handle farmerAccount update (with validation)
    if (updates.farmerAccount !== undefined) {
      if (!mongoose.Types.ObjectId.isValid(updates.farmerAccount)) {
        throw new Error("Invalid farmer account ID format");
      }

      const farmerAccountDoc = await FarmerAccount.findOne({
        _id: updates.farmerAccount,
        storeAdmin: storeAdminId,
      }).session(session);

      if (!farmerAccountDoc) {
        throw new Error("Farmer account not found or does not belong to this store");
      }

      existingOrder.farmerAccount = updates.farmerAccount;
    }

    // Step 5: Recalculate stock values for all orders
    // Get all incoming orders for this cold storage, sorted by creation time
    const allIncomingOrders = await KapoorIncomingOrder.find({
      coldStorageId: storeAdminId,
    })
    .sort({ createdAt: 1 })
    .session(session);

    // Calculate cumulative stock for all orders
    let cumulativeStock = 0;
    for (const order of allIncomingOrders) {
      if (order._id.equals(existingOrder._id)) {
        // For the current order being edited, use the updated quantities
        const orderCurrentStock = existingOrder.incomingBagSizes.reduce((sum, bag) =>
          sum + (bag.quantity.currentQuantity || 0), 0
        );
        cumulativeStock += orderCurrentStock;
        existingOrder.currentStockAtThatTime = cumulativeStock;
      } else {
        // For other orders, use their existing quantities
        const orderCurrentStock = order.incomingBagSizes.reduce((sum, bag) =>
          sum + (bag.quantity.currentQuantity || 0), 0
        );
        cumulativeStock += orderCurrentStock;

        // Update the currentStockAtThatTime for this order
        await KapoorIncomingOrder.updateOne(
          { _id: order._id },
          { $set: { currentStockAtThatTime: cumulativeStock } }
        ).session(session);
      }
    }

    // Step 6: Recalculate farmer-specific stock for the current order
    if (updates.farmerAccount || updates.incomingBagSizes) {
      let farmerCurrentStockAtThatTime = 0;

      try {
        // Get the farmer profile ID from the farmer account
        const farmerAccountDoc = await FarmerAccount.findById(existingOrder.farmerAccount).session(session);
        const farmerProfileId = farmerAccountDoc.profile;

        // Find all previous incoming orders for this specific farmer profile
        const farmerAccounts = await FarmerAccount.find({
          profile: farmerProfileId,
          storeAdmin: storeAdminId
        }).distinct('_id').session(session);

        // Find all previous incoming orders for these accounts (excluding current order)
        const previousFarmerOrders = await KapoorIncomingOrder.find({
          coldStorageId: storeAdminId,
          farmerAccount: { $in: farmerAccounts },
          createdAt: { $lt: existingOrder.createdAt }
        }).session(session);

        // Calculate total current stock from all previous orders for this farmer
        const previousFarmerStock = previousFarmerOrders.reduce((total, order) => {
          const orderCurrentStock = order.incomingBagSizes.reduce((sum, bag) =>
            sum + (bag.quantity.currentQuantity || 0), 0
          );
          return total + orderCurrentStock;
        }, 0);

        // Add the current order's stock to get the running total
        const currentOrderStock = existingOrder.incomingBagSizes.reduce((sum, bag) =>
          sum + (bag.quantity.currentQuantity || 0), 0
        );
        farmerCurrentStockAtThatTime = previousFarmerStock + currentOrderStock;

        existingOrder.farmerCurrentStockAtThatTime = farmerCurrentStockAtThatTime;

        req.log.info("Farmer current stock calculation updated", {
          farmerProfileId,
          previousFarmerStock,
          currentOrderStock,
          farmerCurrentStockAtThatTime,
          storeAdminId,
          requestId: req.id,
        });
      } catch (error) {
        req.log.error("Error calculating farmer current stock", {
          error: error.message,
          storeAdminId,
          requestId: req.id,
        });
        throw new Error("Error calculating farmer current stock");
      }
    }

    // Save the updated order
    const updatedOrder = await existingOrder.save({ session });

    await session.commitTransaction();
    session.endSession();

    req.log.info("Incoming order updated successfully", {
      orderId: updatedOrder._id,
      storeAdminId,
      farmerAccount: updatedOrder.farmerAccount,
      variety: updatedOrder.variety,
      currentStockAtThatTime: updatedOrder.currentStockAtThatTime,
      farmerCurrentStockAtThatTime: updatedOrder.farmerCurrentStockAtThatTime,
      requestId: req.id,
    });

    reply.code(200).send({
      status: "Success",
      message: "Incoming order updated successfully",
      data: updatedOrder,
    });
  } catch (err) {
    req.log.error("Error updating incoming order", {
      error: err.message,
      stack: err.stack,
      orderId: req.params?.id,
      requestId: req.id,
    });

    await session.abortTransaction();
    session.endSession();

    reply.code(400).send({
      status: "Fail",
      message: "Failed to update incoming order",
      errorMessage: err.message,
    });
  }
};

const getReceiptVoucherNumbers = async (req, reply) => {
  try {
    const storeAdminId = req.storeAdmin._id;

    // Get all receipt voucher numbers for this cold storage
    const voucherNumbers = await KapoorIncomingOrder.find({
      coldStorageId: storeAdminId,
    })
      .select("voucher.voucherNumber voucher.type dateOfEntry variety")
      .sort({ "voucher.voucherNumber": 1 });

    req.log.info("Retrieved receipt voucher numbers successfully", {
      storeAdminId: storeAdminId,
      count: voucherNumbers.length,
    });

    return reply.code(200).send({
      status: "Success",
      receiptNumber: voucherNumbers.length,
    });
  } catch (err) {
    req.log.error("Error occurred while retrieving receipt voucher numbers", {
      error: err.message,
    });

    return reply.code(500).send({
      status: "Fail",
      message: "Failed to retrieve receipt voucher numbers",
      errorMessage: err.message,
    });
  }
};

const getKapoorDaybookOrders = async (req, reply) => {
  try {
    const coldStorageId = req.storeAdmin._id;
    const { type, sortBy } = req.query;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const sortOrder = sortBy === "latest" ? -1 : 1;
    const skip = (page - 1) * limit;

    const sortOrderDetails = (orders) => {
      return orders.map((order) => {
        const orderObj = order.toObject ? order.toObject() : order;
        if (orderObj.orderDetails) {
          orderObj.orderDetails = orderObj.orderDetails.map((detail) => ({
            ...detail,
            bagSizes:
              detail.bagSizes?.sort((a, b) => a.size.localeCompare(b.size)) ||
              [],
          }));
        }
        if (orderObj.incomingBagSizes) {
          orderObj.incomingBagSizes = orderObj.incomingBagSizes.sort((a, b) =>
            a.size.localeCompare(b.size)
          );
        }
        return orderObj;
      });
    };

    const createPaginationMeta = (total, page, limit) => {
      const totalPages = Math.ceil(total / limit);
      return {
        currentPage: page,
        totalPages,
        totalItems: total,
        itemsPerPage: limit,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
        nextPage: page < totalPages ? page + 1 : null,
        previousPage: page > 1 ? page - 1 : null,
      };
    };

    req.log.info("Getting kapoor daybook orders", {
      coldStorageId,
      type,
      sortBy,
      page,
      limit,
      sortOrder,
    });

    switch (type) {
      case "all": {
        const [incomingCount, outgoingCount] = await Promise.all([
          KapoorIncomingOrder.countDocuments({ coldStorageId }),
          KapoorOutgoingOrder.countDocuments({ coldStorageId }),
        ]);

        const totalCount = incomingCount + outgoingCount;

        if (totalCount === 0) {
          return reply.code(200).send({
            status: "Fail",
            message: "Cold storage doesn't have any orders",
            pagination: createPaginationMeta(0, page, limit),
          });
        }

        const [allIncomingOrders, allOutgoingOrders] = await Promise.all([
          KapoorIncomingOrder.find({ coldStorageId })
            .sort({ createdAt: sortOrder })
            .populate({
              path: "farmerAccount",
              model: FarmerAccount,
              populate: {
                path: "profile",
                model: "FarmerProfile",
                select: "name mobileNumber address",
              },
              select: "farmerId variety profile",
            })
            .select(
              "_id coldStorageId remarks farmerAccount variety voucher incomingBagSizes dateOfEntry currentStockAtThatTime createdAt"
            ),

          KapoorOutgoingOrder.find({ coldStorageId })
            .sort({ createdAt: sortOrder })
            .populate({
              path: "farmerAccount",
              model: FarmerAccount,
              populate: {
                path: "profile",
                model: "FarmerProfile",
                select: "name mobileNumber address",
              },
              select: "farmerId variety profile",
            })
            .populate({
              path: "orderDetails.incomingOrder._id",
              model: KapoorIncomingOrder,
              select: "voucher incomingBagSizes",
            })
            .select(
              "_id coldStorageId remarks farmerAccount voucher dateOfExtraction orderDetails currentStockAtThatTime createdAt"
            ),
        ]);

        const allOrders = [...allIncomingOrders, ...allOutgoingOrders];
        allOrders.sort((a, b) =>
          sortOrder === -1
            ? new Date(b.createdAt) - new Date(a.createdAt)
            : new Date(a.createdAt) - new Date(b.createdAt)
        );
        const paginatedOrders = allOrders.slice(skip, skip + limit);
        const sortedOrders = sortOrderDetails(paginatedOrders);

        const transformedOrders = sortedOrders.map((order) => {
          const o = order.toObject ? order.toObject() : order;
          const fa = o.farmerAccount;
          const profile = fa?.profile || {};
          const baseAccount = {
            _id: fa._id,
            name: profile.name || "",
            address: profile.address || "",
            mobileNumber: profile.mobileNumber || "",
            farmerId: fa.farmerId,
          };

          if (o.orderDetails) {
            return {
              voucher: o.voucher,
              _id: o._id,
              coldStorageId: o.coldStorageId,
              farmerAccount: baseAccount,
              dateOfExtraction: o.dateOfExtraction,
              remarks: o.remarks,
              currentStockAtThatTime: o.currentStockAtThatTime,
              orderDetails: o.orderDetails.map((detail) => {
                const incomingDoc = detail.incomingOrder?._id?.voucher
                  ? detail.incomingOrder._id
                  : null;
                const incomingOrder = incomingDoc
                  ? {
                      voucher: incomingDoc.voucher,
                      _id: incomingDoc._id,
                      incomingBagSizes: (
                        incomingDoc.incomingBagSizes || []
                      ).map((b) => ({
                        size: b.size,
                        quantity: b.quantity,
                        location: b.location,
                        _id: b._id,
                      })),
                    }
                  : {
                      voucher: detail.incomingOrder?.voucher,
                      _id: detail.incomingOrder?._id,
                      incomingBagSizes:
                        detail.incomingOrder?.incomingBagSizes || [],
                    };

                return {
                  incomingOrder,
                  variety: detail.variety,
                  bagSizes: (detail.bagSizes || []).map((bag) => ({
                    size: bag.size,
                    quantityRemoved: bag.quantityRemoved,
                    location: bag.location,
                  })),
                };
              }),
              createdAt: o.createdAt,
            };
          }

          return {
            voucher: o.voucher,
            _id: o._id,
            coldStorageId: o.coldStorageId,
            farmerAccount: baseAccount,
            dateOfEntry: o.dateOfEntry,
            remarks: o.remarks,
            currentStockAtThatTime: o.currentStockAtThatTime,
            incomingBagSizes: (o.incomingBagSizes || []).map((b) => ({
              size: b.size,
              quantity: b.quantity,
              location: b.location,
              _id: b._id,
            })),
            variety: o.variety,
            createdAt: o.createdAt,
          };
        });

        reply.code(200).send({
          status: "Success",
          data: transformedOrders,
          pagination: createPaginationMeta(totalCount, page, limit),
        });
        break;
      }

      case "incoming": {
        const totalCount = await KapoorIncomingOrder.countDocuments({
          coldStorageId,
        });

        if (totalCount === 0) {
          return reply.code(200).send({
            status: "Fail",
            message: "No incoming orders found.",
            pagination: createPaginationMeta(0, page, limit),
          });
        }

        const incomingOrders = await KapoorIncomingOrder.find({ coldStorageId })
          .skip(skip)
          .limit(limit)
          .sort({ createdAt: sortOrder })
          .populate({
            path: "farmerAccount",
            model: FarmerAccount,
            populate: {
              path: "profile",
              model: "FarmerProfile",
              select: "name mobileNumber address",
            },
            select: "farmerId variety profile",
          })
          .select(
            "_id coldStorageId remarks farmerAccount variety voucher incomingBagSizes dateOfEntry currentStockAtThatTime createdAt"
          );

        const sortedOrders = sortOrderDetails(incomingOrders);

        const transformedOrders = sortedOrders.map((o) => {
          const fa = o.farmerAccount;
          const profile = fa?.profile || {};
          return {
            voucher: o.voucher,
            _id: o._id,
            coldStorageId: o.coldStorageId,
            farmerAccount: {
              _id: fa._id,
              name: profile.name || "",
              address: profile.address || "",
              mobileNumber: profile.mobileNumber || "",
              farmerId: fa.farmerId,
            },
            dateOfEntry: o.dateOfEntry,
            remarks: o.remarks,
            currentStockAtThatTime: o.currentStockAtThatTime,
            incomingBagSizes: (o.incomingBagSizes || []).map((b) => ({
              size: b.size,
              quantity: b.quantity,
              location: b.location,
              _id: b._id,
            })),
            variety: o.variety,
            createdAt: o.createdAt,
          };
        });

        reply.code(200).send({
          status: "Success",
          data: transformedOrders,
          pagination: createPaginationMeta(totalCount, page, limit),
        });
        break;
      }

      case "outgoing": {
        const totalCount = await KapoorOutgoingOrder.countDocuments({
          coldStorageId,
        });

        if (totalCount === 0) {
          return reply.code(200).send({
            status: "Fail",
            message: "No outgoing orders found.",
            pagination: createPaginationMeta(0, page, limit),
          });
        }

        const outgoingOrders = await KapoorOutgoingOrder.find({ coldStorageId })
          .skip(skip)
          .limit(limit)
          .sort({ createdAt: sortOrder })
          .populate({
            path: "farmerAccount",
            model: FarmerAccount,
            populate: {
              path: "profile",
              model: "FarmerProfile",
              select: "name mobileNumber address",
            },
            select: "farmerId variety profile",
          })
          .populate({
            path: "orderDetails.incomingOrder._id",
            model: KapoorIncomingOrder,
            select: "voucher incomingBagSizes",
          })
          .select(
            "_id coldStorageId remarks farmerAccount voucher dateOfExtraction orderDetails currentStockAtThatTime createdAt"
          );

        const sortedOrders = sortOrderDetails(outgoingOrders);

        const transformedOrders = sortedOrders.map((o) => {
          const fa = o.farmerAccount;
          const profile = fa?.profile || {};
          return {
            voucher: o.voucher,
            _id: o._id,
            coldStorageId: o.coldStorageId,
            farmerAccount: {
              _id: fa._id,
              name: profile.name || "",
              address: profile.address || "",
              mobileNumber: profile.mobileNumber || "",
              farmerId: fa.farmerId,
            },
            dateOfExtraction: o.dateOfExtraction,
            remarks: o.remarks,
            currentStockAtThatTime: o.currentStockAtThatTime,
            orderDetails: o.orderDetails.map((detail) => {
              const incomingDoc = detail.incomingOrder?._id?.voucher
                ? detail.incomingOrder._id
                : null;
              const incomingOrder = incomingDoc
                ? {
                    voucher: incomingDoc.voucher,
                    _id: incomingDoc._id,
                    incomingBagSizes: (incomingDoc.incomingBagSizes || []).map(
                      (b) => ({
                        size: b.size,
                        quantity: b.quantity,
                        location: b.location,
                        _id: b._id,
                      })
                    ),
                  }
                : {
                    voucher: detail.incomingOrder?.voucher,
                    _id: detail.incomingOrder?._id,
                    incomingBagSizes:
                      detail.incomingOrder?.incomingBagSizes || [],
                  };
              return {
                incomingOrder,
                variety: detail.variety,
                bagSizes: (detail.bagSizes || []).map((bag) => ({
                  size: bag.size,
                  quantityRemoved: bag.quantityRemoved,
                  location: bag.location,
                })),
              };
            }),
            createdAt: o.createdAt,
          };
        });

        reply.code(200).send({
          status: "Success",
          data: transformedOrders,
          pagination: createPaginationMeta(totalCount, page, limit),
        });
        break;
      }

      default: {
        reply.code(400).send({
          message:
            "Invalid type parameter. Use 'all', 'incoming', or 'outgoing'.",
        });
        break;
      }
    }
  } catch (err) {
    req.log.error("Error getting kapoor daybook orders:", {
      error: err.message,
    });

    reply.code(500).send({
      status: "Fail",
      message: "Some error occurred while getting kapoor incoming orders",
      errorMessage: err.message,
    });
  }
};

/**
 * Get all incoming orders for a single farmer (by FarmerAccount IDs)
 * Expects req.body.farmerAccountIds: Array of FarmerAccount mongoose IDs
 */
const getAllIncomingOrdersOfASingleFarmer = async (req, reply) => {
  try {
    const { farmerAccountIds } = req.body;
    if (!Array.isArray(farmerAccountIds) || farmerAccountIds.length === 0) {
      return reply.code(400).send({
        status: "Fail",
        message: "farmerAccountIds (array) is required in request body",
      });
    }

    // Query all incoming orders where farmerAccount is in the provided IDs
    const orders = await KapoorIncomingOrder.find({
      farmerAccount: { $in: farmerAccountIds },
    })
      .populate({
        path: "farmerAccount",
        model: FarmerAccount,
        populate: {
          path: "profile",
          model: "FarmerProfile",
          select: "name mobileNumber address",
        },
        select: "farmerId variety profile",
      })
      .select(
        "_id coldStorageId remarks farmerAccount variety voucher incomingBagSizes dateOfEntry currentStockAtThatTime farmerCurrentStockAtThatTime createdAt"
      )
      .sort({ createdAt: -1 });

    return reply.code(200).send({
      status: "Success",
      data: orders,
      count: orders.length,
    });
  } catch (err) {
    req.log.error("Error getting incoming orders for farmer:", {
      error: err.message,
    });
    return reply.code(500).send({
      status: "Fail",
      message: "Some error occurred while getting incoming orders for farmer",
      errorMessage: err.message,
    });
  }
};

const getAllOrdersOfASingleFarmer = async (req, reply) => {
  try {
    const { farmerAccountIds } = req.body;
    if (!Array.isArray(farmerAccountIds) || farmerAccountIds.length === 0) {
      return reply.code(400).send({
        status: "Fail",
        message: "farmerAccountIds (array) is required in request body",
      });
    }

    // Incoming orders
    const incomingOrders = await KapoorIncomingOrder.find({
      farmerAccount: { $in: farmerAccountIds },
    })
      .populate({
        path: "farmerAccount",
        model: FarmerAccount,
        populate: {
          path: "profile",
          model: "FarmerProfile",
          select: "name mobileNumber address",
        },
        select: "farmerId variety profile",
      })
      .select(
        "_id coldStorageId remarks farmerAccount variety voucher incomingBagSizes dateOfEntry currentStockAtThatTime farmerCurrentStockAtThatTime createdAt"
      )
      .sort({ createdAt: -1 });

    // Outgoing orders
    const outgoingOrders = await KapoorOutgoingOrder.find({
      farmerAccount: { $in: farmerAccountIds },
    })
      .populate({
        path: "farmerAccount",
        model: FarmerAccount,
        populate: {
          path: "profile",
          model: "FarmerProfile",
          select: "name mobileNumber address",
        },
        select: "farmerId variety profile",
      })
      .select(
        "_id coldStorageId remarks farmerAccount voucher dateOfExtraction currentStockAtThatTime orderDetails createdAt"
      )
      .sort({ createdAt: -1 });

    const sortBagSizes = (bags = []) =>
      bags.sort((a, b) => a.size.localeCompare(b.size));

    // Transform both incoming and outgoing orders
    const transformedOrders = [
      ...incomingOrders.map((o) => {
        const fa = o.farmerAccount || {};
        const profile = fa.profile || {};

        return {
          voucher: o.voucher,
          _id: o._id,
          coldStorageId: o.coldStorageId,
          farmerAccount: {
            _id: fa._id,
            name: profile.name || "",
            address: profile.address || "",
            mobileNumber: profile.mobileNumber || "",
            farmerId: fa.farmerId,
          },
          dateOfEntry: o.dateOfEntry,
          remarks: o.remarks,
          currentStockAtThatTime: o.currentStockAtThatTime,
          farmerCurrentStockAtThatTime: o.farmerCurrentStockAtThatTime,
          incomingBagSizes: sortBagSizes(
            (o.incomingBagSizes || []).map((b) => ({
              size: b.size,
              quantity: b.quantity,
              location: b.location,
              _id: b._id,
            }))
          ),
          variety: o.variety,
          createdAt: o.createdAt,
        };
      }),

      ...outgoingOrders.map((o) => {
        const fa = o.farmerAccount || {};
        const profile = fa.profile || {};

        return {
          voucher: o.voucher,
          _id: o._id,
          coldStorageId: o.coldStorageId,
          farmerAccount: {
            _id: fa._id,
            name: profile.name || "",
            address: profile.address || "",
            mobileNumber: profile.mobileNumber || "",
            farmerId: fa.farmerId,
          },
          dateOfExtraction: o.dateOfExtraction,
          remarks: o.remarks,
          currentStockAtThatTime: o.currentStockAtThatTime,
          orderDetails: (o.orderDetails || []).map((detail) => {
            const incomingOrder = detail.incomingOrder || {};

            return {
              incomingOrder: {
                voucher: incomingOrder.voucher,
                _id: incomingOrder._id,
                incomingBagSizes: sortBagSizes(
                  (incomingOrder.incomingBagSizes || []).map((b) => ({
                    size: b.size,
                    quantity: b.quantity,
                    location: b.location,
                    _id: b._id,
                  }))
                ),
              },
              variety: detail.variety,
              bagSizes: sortBagSizes(
                (detail.bagSizes || []).map((bag) => ({
                  size: bag.size,
                  quantityRemoved: bag.quantityRemoved,
                  location: bag.location,
                }))
              ),
            };
          }),
          createdAt: o.createdAt,
        };
      }),
    ];

    // Sort by createdAt DESC
    transformedOrders.sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
    );

    return reply.code(200).send({
      status: "Success",
      data: transformedOrders,
      counts: {
        incoming: incomingOrders.length,
        outgoing: outgoingOrders.length,
      },
    });
  } catch (err) {
    req.log.error("Error getting farmer orders:", {
      error: err.message,
    });
    return reply.code(500).send({
      status: "Fail",
      message: "Some error occurred while getting orders for farmer",
      errorMessage: err.message,
    });
  }
};

const getKapoorColdStorageSummary = async (req, reply) => {
  try {
    const coldStorageId = req.storeAdmin._id;

    req.log.info("Starting Kapoor cold storage summary calculation", {
      coldStorageId,
      requestId: req.id,
    });

    if (!coldStorageId) {
      req.log.warn("Missing coldStorageId for cold storage summary", {
        requestId: req.id,
      });
      return reply.code(400).send({
        status: "Fail",
        message: "coldStorageId is required",
      });
    }

    // Validate MongoDB ObjectId
    if (!mongoose.Types.ObjectId.isValid(coldStorageId)) {
      req.log.warn("Invalid coldStorageId format in cold storage summary", {
        coldStorageId,
        isValid: mongoose.Types.ObjectId.isValid(coldStorageId),
        requestId: req.id,
      });
      return reply.code(400).send({
        status: "Fail",
        message: "Invalid ID format",
        errorMessage: "Please provide a valid MongoDB ObjectId",
      });
    }

    // Get store admin creation date
    const storeAdmin = await StoreAdmin.findById(coldStorageId);
    if (!storeAdmin) {
      req.log.warn("Store admin not found", {
        coldStorageId,
        requestId: req.id,
      });
      return reply.code(404).send({
        status: "Fail",
        message: "Store admin not found",
      });
    }

    const storeAdminCreationDate = storeAdmin.createdAt;
    req.log.info("Retrieved store admin creation date", {
      coldStorageId,
      creationDate: storeAdminCreationDate,
      requestId: req.id,
    });

    // Get stock trend data (from store admin creation date)
    const [allIncomingOrders, allOutgoingOrders] = await Promise.all([
      KapoorIncomingOrder.find({
        coldStorageId: new mongoose.Types.ObjectId(coldStorageId),
        createdAt: { $gte: storeAdminCreationDate },
      }).sort({ createdAt: 1 }),
      KapoorOutgoingOrder.find({
        coldStorageId: new mongoose.Types.ObjectId(coldStorageId),
        createdAt: { $gte: storeAdminCreationDate },
      }).sort({ createdAt: 1 }),
    ]);

    // Create monthly data points from store admin creation date to current date
    const monthlyData = {};
    const months = [];
    const currentDate = new Date();
    let iterationDate = new Date(storeAdminCreationDate);

    // Initialize months from creation date to current date (including current month)
    while (iterationDate <= currentDate) {
      const monthKey = iterationDate.toLocaleString("en-US", {
        month: "short",
        year: "2-digit",
      });
      monthlyData[monthKey] = {
        totalStock: 0,
        month: monthKey,
      };
      months.push(monthKey);
      iterationDate.setMonth(iterationDate.getMonth() + 1);
    }

    // Ensure current month is always included
    const currentMonthKey = currentDate.toLocaleString("en-US", {
      month: "short",
      year: "2-digit",
    });
    if (!monthlyData[currentMonthKey]) {
      monthlyData[currentMonthKey] = {
        totalStock: 0,
        month: currentMonthKey,
      };
      months.push(currentMonthKey);
    }

    // Calculate running stock for each month
    let runningStock = 0;

    // Process incoming orders
    allIncomingOrders.forEach((order) => {
      const monthKey = new Date(order.createdAt).toLocaleString("en-US", {
        month: "short",
        year: "2-digit",
      });
      if (monthlyData[monthKey]) {
        const orderStock = order.incomingBagSizes.reduce(
          (total, bag) => total + bag.quantity.currentQuantity,
          0
        );
        runningStock += orderStock;
        monthlyData[monthKey].totalStock = runningStock;
      }
    });

    // Process outgoing orders
    allOutgoingOrders.forEach((order) => {
      const monthKey = new Date(order.createdAt).toLocaleString("en-US", {
        month: "short",
        year: "2-digit",
      });
      if (monthlyData[monthKey]) {
        const orderStock = order.orderDetails.reduce(
          (total, detail) =>
            total +
            detail.bagSizes.reduce((sum, bag) => sum + bag.quantityRemoved, 0),
          0
        );
        runningStock -= orderStock;
        monthlyData[monthKey].totalStock = runningStock;
      }
    });

    // Ensure current month shows the most up-to-date stock
    if (monthlyData[currentMonthKey]) {
      // Calculate current total stock from all incoming orders
      const currentTotalStock = await KapoorIncomingOrder.aggregate([
        {
          $match: {
            coldStorageId: new mongoose.Types.ObjectId(coldStorageId),
          },
        },
        { $unwind: "$incomingBagSizes" },
        {
          $group: {
            _id: null,
            totalCurrentQuantity: {
              $sum: "$incomingBagSizes.quantity.currentQuantity",
            },
          },
        },
      ]);

      const totalIncomingStock =
        currentTotalStock.length > 0
          ? currentTotalStock[0].totalCurrentQuantity
          : 0;

      // Calculate total outgoing stock
      const totalOutgoingStock = await KapoorOutgoingOrder.aggregate([
        {
          $match: {
            coldStorageId: new mongoose.Types.ObjectId(coldStorageId),
          },
        },
        { $unwind: "$orderDetails" },
        { $unwind: "$orderDetails.bagSizes" },
        {
          $group: {
            _id: null,
            totalQuantityRemoved: {
              $sum: "$orderDetails.bagSizes.quantityRemoved",
            },
          },
        },
      ]);

      const totalOutgoing =
        totalOutgoingStock.length > 0
          ? totalOutgoingStock[0].totalQuantityRemoved
          : 0;

      // Set current month's stock to the actual current stock
      monthlyData[currentMonthKey].totalStock =
        totalIncomingStock - totalOutgoing;

      req.log.info("Current month stock calculation", {
        currentMonthKey,
        totalIncomingStock,
        totalOutgoing,
        calculatedStock: totalIncomingStock - totalOutgoing,
        requestId: req.id,
      });
    }

    // Convert to array format for the frontend
    const stockTrend = months.map((month) => ({
      month: month,
      totalStock: monthlyData[month].totalStock,
    }));

    req.log.info("Stock trend calculation details", {
      coldStorageId,
      storeAdminCreationDate,
      currentDate,
      monthsGenerated: months,
      currentMonthKey,
      stockTrendLength: stockTrend.length,
      requestId: req.id,
    });

    // Aggregate incoming orders by variety and bag size
    const incomingOrdersAgg = await KapoorIncomingOrder.aggregate([
      {
        $match: {
          coldStorageId: new mongoose.Types.ObjectId(coldStorageId),
        },
      },
      { $unwind: "$incomingBagSizes" },
      {
        $group: {
          _id: {
            variety: "$variety",
            size: "$incomingBagSizes.size",
          },
          initialQuantity: {
            $sum: "$incomingBagSizes.quantity.initialQuantity",
          },
          currentQuantity: {
            $sum: "$incomingBagSizes.quantity.currentQuantity",
          },
        },
      },
    ]);

    // Transform incoming orders into a structured object
    const incomingSummaryAgg = incomingOrdersAgg.reduce((acc, order) => {
      const { variety, size } = order._id;
      if (!acc[variety]) acc[variety] = {};
      acc[variety][size] = {
        initialQuantity: order.initialQuantity,
        currentQuantity: order.currentQuantity,
      };
      return acc;
    }, {});

    // Aggregate outgoing orders
    const outgoingOrdersAgg = await KapoorOutgoingOrder.aggregate([
      {
        $match: {
          coldStorageId: new mongoose.Types.ObjectId(coldStorageId),
        },
      },
      { $unwind: "$orderDetails" },
      { $unwind: "$orderDetails.bagSizes" },
      {
        $group: {
          _id: {
            variety: "$orderDetails.variety",
            size: "$orderDetails.bagSizes.size",
          },
          quantityRemoved: {
            $sum: "$orderDetails.bagSizes.quantityRemoved",
          },
        },
      },
    ]);

    // Add outgoing quantities to the structured object
    outgoingOrdersAgg.forEach((order) => {
      const { variety, size } = order._id;
      if (!incomingSummaryAgg[variety]) incomingSummaryAgg[variety] = {};
      if (!incomingSummaryAgg[variety][size]) {
        incomingSummaryAgg[variety][size] = {
          initialQuantity: 0,
          currentQuantity: 0,
        };
      }
      incomingSummaryAgg[variety][size].quantityRemoved = order.quantityRemoved;
    });

    // Convert the stock summary object into an array
    const stockSummaryArrayAgg = Object.entries(incomingSummaryAgg).map(
      ([variety, sizes]) => ({
        variety,
        sizes: Object.entries(sizes).map(([size, quantities]) => ({
          size,
          ...quantities,
        })),
      })
    );

    req.log.info(
      "Successfully generated Kapoor cold storage summary with trend analysis",
      {
        coldStorageId,
        varietiesCount: stockSummaryArrayAgg.length,
        totalSizes: stockSummaryArrayAgg.reduce(
          (acc, item) => acc + item.sizes.length,
          0
        ),
        trendDataPoints: stockTrend.length,
        requestId: req.id,
      }
    );

    reply.code(200).send({
      status: "Success",
      stockSummary: stockSummaryArrayAgg,
      stockTrend: stockTrend,
    });
  } catch (err) {
    req.log.error("Error in Kapoor cold storage summary calculation", {
      error: err.message,
      stack: err.stack,
      coldStorageId: req.storeAdmin._id,
      requestId: req.id,
    });
    reply.code(500).send({
      status: "Fail",
      message: "Error occurred while calculating Kapoor cold storage summary",
      errorMessage: err.message,
    });
  }
};

const getKapoorTopFarmers = async (req, reply) => {
  try {
    const storeAdminId = req.storeAdmin._id;

    req.log.info("Starting getKapoorTopFarmers calculation", {
      storeAdminId,
      requestId: req.id,
    });

    if (!storeAdminId || !mongoose.Types.ObjectId.isValid(storeAdminId)) {
      req.log.warn("Invalid storeAdminId provided", {
        storeAdminId,
        requestId: req.id,
      });
      return reply.code(400).send({
        status: "Fail",
        message: "Valid store admin ID is required",
      });
    }

    const topFarmers = await KapoorIncomingOrder.aggregate([
      // Match orders for the specific cold storage
      {
        $match: {
          coldStorageId: new mongoose.Types.ObjectId(storeAdminId),
        },
      },
      // Unwind the bag sizes array
      { $unwind: "$incomingBagSizes" },
      // Group by farmer account and calculate totals
      {
        $group: {
          _id: "$farmerAccount",
          totalBags: {
            $sum: "$incomingBagSizes.quantity.initialQuantity",
          },
          bagSizeDetails: {
            $push: {
              size: "$incomingBagSizes.size",
              quantity: "$incomingBagSizes.quantity.initialQuantity",
            },
          },
          varieties: { $addToSet: "$variety" },
        },
      },
      // Group bag sizes properly
      {
        $project: {
          _id: 1,
          totalBags: 1,
          varieties: 1,
          bagSummary: {
            $arrayToObject: {
              $map: {
                input: {
                  $setUnion: "$bagSizeDetails.size",
                },
                as: "size",
                in: {
                  k: "$$size",
                  v: {
                    $sum: {
                      $map: {
                        input: {
                          $filter: {
                            input: "$bagSizeDetails",
                            as: "sizeDetail",
                            cond: { $eq: ["$$sizeDetail.size", "$$size"] },
                          },
                        },
                        as: "filteredSize",
                        in: "$$filteredSize.quantity",
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      // Lookup farmer account details
      {
        $lookup: {
          from: "farmeraccounts",
          localField: "_id",
          foreignField: "_id",
          as: "farmerAccount",
        },
      },
      // Unwind farmer account
      {
        $unwind: {
          path: "$farmerAccount",
          preserveNullAndEmptyArrays: true,
        },
      },
      // Lookup farmer profile through farmer account
      {
        $lookup: {
          from: "farmerprofiles",
          localField: "farmerAccount.profile",
          foreignField: "_id",
          as: "farmerProfile",
        },
      },
      // Unwind farmer profile
      {
        $unwind: {
          path: "$farmerProfile",
          preserveNullAndEmptyArrays: true,
        },
      },
      // Project final format
      {
        $project: {
          farmerId: "$_id",
          farmerName: { $ifNull: ["$farmerProfile.name", "Unknown Farmer"] },
          fatherName: { $ifNull: ["$farmerProfile.fatherName", "Unknown"] },
          address: { $ifNull: ["$farmerProfile.address", ""] },
          mobileNumber: { $ifNull: ["$farmerProfile.mobileNumber", ""] },
          accountId: "$farmerAccount.farmerId",
          totalBags: 1,
          bagSummary: 1,
          varieties: 1,
        },
      },
      // Sort by total bags in descending order
      {
        $sort: { totalBags: -1 },
      },
      // Limit to top 5 farmers
      {
        $limit: 5,
      },
    ]);

    req.log.info("Successfully retrieved top farmers", {
      storeAdminId,
      farmersCount: topFarmers.length,
      requestId: req.id,
    });

    if (!topFarmers.length) {
      req.log.info("No farmers found for this cold storage", {
        storeAdminId,
        requestId: req.id,
      });
      return reply.code(200).send({
        status: "Success",
        message: "No farmers found for this cold storage",
        data: [],
      });
    }

    reply.code(200).send({
      status: "Success",
      message: "Top farmers retrieved successfully",
      data: topFarmers,
    });
  } catch (err) {
    req.log.error("Error in getKapoorTopFarmers:", {
      error: err.message,
      stack: err.stack,
      storeAdminId: req.storeAdmin._id,
      requestId: req.id,
    });
    reply.code(500).send({
      status: "Fail",
      message: "Error occurred while retrieving top farmers",
      errorMessage: err.message,
    });
  }
};

const searchKapoorOrdersByVariety = async (req, reply) => {
  try {
    const { variety, storeAdminId } = req.body;

    req.log.info("Starting Kapoor order search by variety", {
      variety,
      storeAdminId,
      requestId: req.id,
    });

    // Validate required fields
    if (!variety || !storeAdminId) {
      req.log.warn("Missing required fields", {
        variety,
        storeAdminId,
        requestId: req.id,
      });
      return reply.code(400).send({
        status: "Fail",
        message: "Missing required fields",
        errorMessage: "variety and storeAdminId are required",
      });
    }

    // Validate MongoDB ObjectId
    if (!mongoose.Types.ObjectId.isValid(storeAdminId)) {
      req.log.warn("Invalid storeAdminId format", {
        storeAdminId,
        requestId: req.id,
      });
      return reply.code(400).send({
        status: "Fail",
        message: "Invalid ID format",
        errorMessage: "Please provide a valid MongoDB ObjectId",
      });
    }

    // Build the match condition for variety
    const matchCondition = {
      coldStorageId: new mongoose.Types.ObjectId(storeAdminId),
      variety: variety,
    };

    req.log.info("Executing Kapoor order search query", {
      variety,
      storeAdminId,
      matchCondition,
      requestId: req.id,
    });

    // Find orders matching the criteria with populated farmer details
    const orders = await KapoorIncomingOrder.find(matchCondition)
      .populate({
        path: "farmerAccount",
        model: "FarmerAccount",
        populate: {
          path: "profile",
          model: "FarmerProfile",
          select: "name fatherName mobileNumber address",
        },
        select: "farmerId profile variety",
      })
      .sort({ createdAt: -1 });

    req.log.info("Order search completed", {
      variety,
      ordersFound: orders.length,
      requestId: req.id,
    });

    if (!orders || orders.length === 0) {
      req.log.info("No orders found for specified variety", {
        variety,
        storeAdminId,
        requestId: req.id,
      });
      return reply.code(404).send({
        status: "Fail",
        message: "No orders found with the specified variety",
      });
    }

    // Process orders and sort bag sizes
    const processedOrders = orders.map((order) => {
      const orderObj = order.toObject();

      // Sort bag sizes by size string
      orderObj.incomingBagSizes = orderObj.incomingBagSizes.sort((a, b) =>
        a.size.localeCompare(b.size)
      );

      // Format farmer information
      const farmerAccount = orderObj.farmerAccount || {};
      const profile = farmerAccount.profile || {};

      return {
        _id: orderObj._id,
        variety: orderObj.variety,
        dateOfEntry: orderObj.dateOfEntry,
        voucher: orderObj.voucher,
        remarks: orderObj.remarks,
        currentStockAtThatTime: orderObj.currentStockAtThatTime,
        incomingBagSizes: orderObj.incomingBagSizes,
        farmer: {
          accountId: farmerAccount.farmerId,
          name: profile.name || "Unknown Farmer",
          fatherName: profile.fatherName || "Unknown",
          mobileNumber: profile.mobileNumber || "",
          address: profile.address || "",
        },
        createdAt: orderObj.createdAt,
      };
    });

    req.log.info("Successfully retrieved and processed orders", {
      variety,
      orderCount: processedOrders.length,
      requestId: req.id,
    });

    reply.code(200).send({
      status: "Success",
      message: "Orders retrieved successfully",
      data: processedOrders,
    });
  } catch (err) {
    req.log.error("Error occurred while searching Kapoor orders", {
      variety: req.body?.variety,
      storeAdminId: req.body?.storeAdminId,
      errorMessage: err.message,
      stack: err.stack,
      requestId: req.id,
    });

    reply.code(500).send({
      status: "Fail",
      message: "Error occurred while searching orders",
      errorMessage: err.message,
    });
  }
};

const createOutgoingOrder = async (req, reply) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    req.log.info("Starting createOutgoingOrder process", {
      storeAdminId: req.storeAdmin._id,
      farmerId: req.params.id,
      body: req.body,
    });

    const { orders, remarks } = req.body;
    const { id } = req.params;

    console.log("orders is: ", orders);

    // Validate orders array
    if (!Array.isArray(orders) || orders.length === 0) {
      req.log.warn("Invalid orders array provided", {
        isArray: Array.isArray(orders),
        length: orders?.length,
      });
      throw new Error("Orders array is required and cannot be empty");
    }

    req.log.info("Validating order structure", { orderCount: orders.length });

    // Validate each order's structure
    orders.forEach((order, index) => {
      req.log.info("Validating order", {
        orderIndex: index,
        orderId: order.orderId,
        variety: order.variety,
        bagUpdatesCount: order.bagUpdates?.length,
      });

      if (
        !order.orderId ||
        !order.variety ||
        !Array.isArray(order.bagUpdates)
      ) {
        req.log.warn("Invalid order structure detected", {
          orderIndex: index,
          hasOrderId: !!order.orderId,
          hasVariety: !!order.variety,
          hasBagUpdates: Array.isArray(order.bagUpdates),
        });
        throw new Error(
          "Invalid order structure. Required fields: orderId, variety, bagUpdates"
        );
      }

      // Validate bagUpdates
      order.bagUpdates.forEach((update, bagIndex) => {
        req.log.info("Validating bag update", {
          orderIndex: index,
          bagIndex,
          size: update.size,
          location: update.location,
          quantityToRemove: update.quantityToRemove,
        });

        if (
          !update.size ||
          !update.location ||
          typeof update.quantityToRemove !== "number"
        ) {
          req.log.warn("Invalid bag update structure", {
            orderIndex: index,
            bagIndex,
            hasSize: !!update.size,
            hasLocation: !!update.location,
            quantityType: typeof update.quantityToRemove,
          });
          throw new Error(
            "Invalid bag update structure. Required fields: size, location, quantityToRemove"
          );
        }

        // Check for negative quantities
        if (update.quantityToRemove < 0) {
          req.log.warn("Negative quantity to remove detected", {
            orderIndex: index,
            bagIndex,
            quantityToRemove: update.quantityToRemove,
          });
          throw new Error(
            `Invalid quantity to remove: ${update.quantityToRemove}. Must be greater than or equal to 0`
          );
        }
      });
    });

    req.log.info("Starting to fetch and validate incoming orders");

    // Fetch incoming orders to validate and build map
    const incomingOrders = await Promise.all(
      orders.map(async (order, index) => {
        const { orderId, variety, bagUpdates } = order;

        req.log.info("Fetching order details", {
          orderIndex: index,
          orderId,
          variety,
        });

        const fetchedOrder = await KapoorIncomingOrder.findById(orderId).lean();
        if (!fetchedOrder) {
          req.log.warn("Order not found", {
            orderIndex: index,
            orderId,
          });
          throw new Error(`Order with ID ${orderId} not found`);
        }

        // Model does not have orderDetails, so use variety and incomingBagSizes
        if (fetchedOrder.variety !== variety) {
          req.log.warn("Variety not found in order", {
            orderIndex: index,
            orderId,
            variety,
            fetchedVariety: fetchedOrder.variety,
          });
          throw new Error(`Variety ${variety} not found in order ${orderId}`);
        }

        const matchingDetail = {
          variety: fetchedOrder.variety,
          bagSizes: fetchedOrder.incomingBagSizes,
        };

        req.log.info("Validating quantities for bag updates", {
          orderIndex: index,
          orderId,
          variety,
          bagUpdatesCount: bagUpdates.length,
        });

        // Validate quantities for each bag update
        bagUpdates.forEach((update, bagIndex) => {
          const { size, location, quantityToRemove } = update;

          const matchingBag = matchingDetail.bagSizes.find(
            (bag) => bag.size === size && bag.location === location
          );

          if (!matchingBag) {
            req.log.warn("Bag size/location not found", {
              orderIndex: index,
              bagIndex,
              size: size,
              location: location,
              availableBags: matchingDetail.bagSizes.map((b) => ({
                size: b.size,
                location: b.location,
              })),
            });
            throw new Error(
              `Bag size ${size} at location ${location} not found for variety ${variety} in order ${orderId}`
            );
          }

          req.log.info("Checking quantity availability", {
            orderIndex: index,
            bagIndex,
            size: size,
            location: location,
            requested: quantityToRemove,
            available: matchingBag.quantity.currentQuantity, // 🔧 FIXED: Access currentQuantity
          });

          if (matchingBag.quantity.currentQuantity < quantityToRemove) {
            req.log.warn("Insufficient quantity available", {
              orderIndex: index,
              bagIndex,
              variety,
              size: size,
              location: location,
              requested: quantityToRemove,
              available: matchingBag.quantity.currentQuantity, // 🔧 FIXED: Access currentQuantity
            });
            throw new Error(
              `Insufficient quantity available for ${variety} size ${size} at ${location}. ` +
                `Requested: ${quantityToRemove}, Available: ${matchingBag.quantity.currentQuantity}`
            );
          }
        });

        req.log.info("Successfully processed order", {
          orderIndex: index,
          orderId,
          variety,
        });

        return {
          _id: fetchedOrder._id,
          voucher: fetchedOrder.voucher,
          orderDetails: [
            {
              variety,
              bagSizes: matchingDetail.bagSizes,
            },
          ],
          // 🔧 FIXED: Properly structure the quantity object according to schema
          mappedIncomingBagSizes: fetchedOrder.incomingBagSizes.map((bag) => ({
            size: bag.size,
            quantity: {
              initialQuantity: bag.quantity.initialQuantity, // Access nested properties
              currentQuantity: bag.quantity.currentQuantity, // Access nested properties
            },
            location: bag.location,
          })),
        };
      })
    );

    req.log.info("Successfully validated all orders and quantities", {
      processedOrdersCount: incomingOrders.length,
    });

    const incomingOrderMap = Object.fromEntries(
      incomingOrders.map((o) => [o._id.toString(), o])
    );

    // Calculate total current stock from all incoming orders BEFORE any reductions
    const totalIncomingStock = await KapoorIncomingOrder.aggregate([
      {
        $match: {
          coldStorageId: new mongoose.Types.ObjectId(req.storeAdmin._id),
        },
      },
      { $unwind: "$incomingBagSizes" },
      {
        $group: {
          _id: null,
          totalCurrentQuantity: {
            $sum: "$incomingBagSizes.quantity.currentQuantity",
          }, // 🔧 FIXED: Access nested currentQuantity
        },
      },
    ]);

    console.log("Total incoming stock aggregation result:", totalIncomingStock);
    console.log(
      "Total incoming stock value:",
      totalIncomingStock.length > 0
        ? totalIncomingStock[0].totalCurrentQuantity
        : 0
    );

    // Calculate current outgoing order total
    const currentOutgoingTotal = orders.reduce((total, order) => {
      console.log("Processing order for total calculation:", order);
      const orderTotal = order.bagUpdates.reduce((bagTotal, update) => {
        console.log("Processing bag update:", update);
        console.log("Current bag total:", bagTotal);
        console.log("Adding quantity:", update.quantityToRemove);
        return bagTotal + update.quantityToRemove;
      }, 0);
      console.log("Order total:", orderTotal);
      return total + orderTotal;
    }, 0);

    console.log("Current outgoing order total:", currentOutgoingTotal);

    // Calculate currentStockAtThatTime (modified formula)
    const incomingTotal =
      totalIncomingStock.length > 0
        ? totalIncomingStock[0].totalCurrentQuantity
        : 0;
    const currentStockAtThatTime = incomingTotal - currentOutgoingTotal;

    console.log("Final calculation breakdown (Modified):");
    console.log("- Total Incoming Stock:", incomingTotal);
    console.log("- Current Order's Outgoing Total:", currentOutgoingTotal);
    console.log("= Current Stock At That Time:", currentStockAtThatTime);

    req.log.info("Stock calculation completed", {
      incomingTotal,
      currentOutgoingTotal,
      currentStockAtThatTime,
    });

    // Initialize bulk operations array
    const bulkOps = [];

    const outgoingOrderDetails = orders.map(
      ({ orderId, variety, bagUpdates }) => {
        console.log("Processing variety:", variety);

        const bagSizes = bagUpdates
          .filter((u) => u.quantityToRemove > 0) // Filter out zero quantities
          .map(({ size, location, quantityToRemove }) => {
            console.log("Processing bag update:", {
              size,
              location,
              quantityToRemove,
              variety,
            });

            // 🔧 FIXED: Update the nested currentQuantity field in the incoming order
            bulkOps.push({
              updateOne: {
                filter: {
                  _id: new mongoose.Types.ObjectId(orderId),
                  variety: variety,
                  "incomingBagSizes.size": size,
                  "incomingBagSizes.location": location,
                },
                update: {
                  $inc: {
                    "incomingBagSizes.$.quantity.currentQuantity":
                      -quantityToRemove, // 🔧 FIXED: Target nested currentQuantity
                  },
                },
              },
            });

            return {
              size,
              location,
              quantityRemoved: quantityToRemove,
            };
          });

        // Use mappedIncomingBagSizes for the required structure
        return {
          variety,
          incomingOrder: {
            _id: orderId,
            voucher: incomingOrderMap[orderId]?.voucher,
            incomingBagSizes:
              incomingOrderMap[orderId]?.mappedIncomingBagSizes || [],
          },
          bagSizes,
        };
      }
    );

    // Execute bulk write for inventory updates
    if (bulkOps.length > 0) {
      const result = await KapoorIncomingOrder.bulkWrite(bulkOps, { session });
      req.log.info("Bulk operations completed", {
        modifiedCount: result.modifiedCount,
        matchedCount: result.matchedCount,
      });
    }

    // Get delivery voucher number (assuming helper exists)
    const deliveryVoucherNumber = await getDeliveryVoucherNumberHelper(
      req.storeAdmin._id
    );

    // Create the outgoing order document
    const outgoingOrder = new KapoorOutgoingOrder({
      coldStorageId: req.storeAdmin._id,
      farmerAccount: id,
      voucher: {
        type: "DELIVERY",
        voucherNumber: deliveryVoucherNumber,
      },
      dateOfExtraction: formatDate(new Date()),
      orderDetails: outgoingOrderDetails,
      currentStockAtThatTime,
      remarks,
      createdBy: req.storeAdmin._id,
    });

    await outgoingOrder.save({ session });
    req.log.info("Outgoing order saved", {
      outgoingOrderId: outgoingOrder._id,
    });

    await session.commitTransaction();
    session.endSession();

    req.log.info("Transaction committed successfully");

    return reply.code(200).send({
      status: "Success",
      message: "Outgoing order created successfully",
      outgoingOrder,
    });
  } catch (err) {
    req.log.error("Error processing outgoing order", {
      errorMessage: err.message,
    });

    await session.abortTransaction();
    session.endSession();

    return reply.code(500).send({
      status: "Fail",
      message: "Error creating outgoing order",
      errorMessage: err.message,
    });
  }
};

const getFarmerStockSummary = async (req, reply) => {
  try {
    const coldStorageId = req.storeAdmin._id;
    const { farmerAccountIds } = req.body;

    req.log.info("Starting farmer stock summary calculation", {
      farmerAccountIds,
      coldStorageId,
      requestId: req.id,
    });

    if (!farmerAccountIds || !Array.isArray(farmerAccountIds) || farmerAccountIds.length === 0) {
      req.log.warn("Missing or invalid farmer account IDs in request body", {
        farmerAccountIds,
        coldStorageId,
        requestId: req.id,
      });
      return reply.code(400).send({
        status: "Fail",
        message: "farmerAccountIds array is required and must not be empty",
      });
    }

    if (!coldStorageId) {
      req.log.warn("Missing cold storage ID for farmer stock summary", {
        coldStorageId,
        requestId: req.id,
      });
      return reply.code(400).send({
        status: "Fail",
        message: "coldStorageId is required",
      });
    }

    // Validate MongoDB ObjectIds
    const invalidIds = farmerAccountIds.filter(id => !mongoose.Types.ObjectId.isValid(id));
    if (invalidIds.length > 0) {
      req.log.warn("Invalid ObjectId format in farmer account IDs", {
        invalidIds,
        coldStorageId,
        requestId: req.id,
      });
      return reply.code(400).send({
        status: "Fail",
        message: "Invalid ID format",
        errorMessage: "Please provide valid MongoDB ObjectIds",
        invalidIds,
      });
    }

    if (!mongoose.Types.ObjectId.isValid(coldStorageId)) {
      req.log.warn("Invalid cold storage ID format", {
        coldStorageId,
        requestId: req.id,
      });
      return reply.code(400).send({
        status: "Fail",
        message: "Invalid cold storage ID format",
        errorMessage: "Please provide valid MongoDB ObjectId",
      });
    }

    // Validate that all farmer accounts belong to the same farmer profile
    req.log.info("Validating farmer accounts belong to same profile", {
      farmerAccountIds,
      requestId: req.id,
    });

    const farmerAccounts = await FarmerAccount.find({
      _id: { $in: farmerAccountIds },
      storeAdmin: coldStorageId,
    }).populate('profile', 'name fatherName');

    if (farmerAccounts.length !== farmerAccountIds.length) {
      req.log.warn("Some farmer accounts not found", {
        requestedIds: farmerAccountIds,
        foundAccounts: farmerAccounts.length,
        requestId: req.id,
      });
      return reply.code(400).send({
        status: "Fail",
        message: "Some farmer accounts not found",
        errorMessage: "One or more farmer account IDs do not exist in this cold storage",
      });
    }

    // Check if all accounts belong to the same farmer profile
    const uniqueProfiles = [...new Set(farmerAccounts.map(account => account.profile._id.toString()))];
    if (uniqueProfiles.length > 1) {
      req.log.warn("Farmer accounts belong to different profiles", {
        farmerAccountIds,
        uniqueProfiles,
        requestId: req.id,
      });
      return reply.code(400).send({
        status: "Fail",
        message: "Farmer accounts must belong to the same farmer profile",
        errorMessage: "All farmer accounts must be associated with the same farmer profile",
        uniqueProfiles: uniqueProfiles.length,
        farmerAccounts: farmerAccounts.map(acc => ({
          accountId: acc._id,
          profileName: acc.profile.name,
          profileFatherName: acc.profile.fatherName,
        })),
      });
    }

    req.log.info("Farmer accounts validation passed", {
      farmerAccountIds,
      profileId: uniqueProfiles[0],
      requestId: req.id,
    });

    req.log.info("Starting farmer incoming orders aggregation", {
      farmerAccountIds,
      coldStorageId,
      requestId: req.id,
    });

    // Aggregate incoming orders for all farmer accounts
    const incomingOrders = await KapoorIncomingOrder.aggregate([
      {
        $match: {
          farmerAccount: { $in: farmerAccountIds.map(id => new mongoose.Types.ObjectId(id)) },
          coldStorageId: new mongoose.Types.ObjectId(coldStorageId),
        },
      },
      { $unwind: "$incomingBagSizes" },
      {
        $group: {
          _id: {
            farmerAccount: "$farmerAccount",
            variety: "$variety",
            size: "$incomingBagSizes.size",
          },
          initialQuantity: {
            $sum: "$incomingBagSizes.quantity.initialQuantity",
          },
          currentQuantity: {
            $sum: "$incomingBagSizes.quantity.currentQuantity",
          },
        },
      },
    ]);

    req.log.info("Completed farmer incoming orders aggregation", {
      farmerAccountIds,
      incomingOrdersCount: incomingOrders.length,
      requestId: req.id,
    });

    req.log.info("Starting farmer outgoing orders aggregation", {
      farmerAccountIds,
      coldStorageId,
      requestId: req.id,
    });

    // Aggregate outgoing orders for all farmer accounts
    const outgoingOrders = await KapoorOutgoingOrder.aggregate([
      {
        $match: {
          farmerAccount: { $in: farmerAccountIds.map(id => new mongoose.Types.ObjectId(id)) },
          coldStorageId: new mongoose.Types.ObjectId(coldStorageId),
        },
      },
      { $unwind: "$orderDetails" },
      { $unwind: "$orderDetails.bagSizes" },
      {
        $group: {
          _id: {
            farmerAccount: "$farmerAccount",
            variety: "$orderDetails.variety",
            size: "$orderDetails.bagSizes.size",
          },
          quantityRemoved: {
            $sum: "$orderDetails.bagSizes.quantityRemoved",
          },
        },
      },
    ]);

    req.log.info("Completed farmer outgoing orders aggregation", {
      farmerAccountIds,
      outgoingOrdersCount: outgoingOrders.length,
      requestId: req.id,
    });

    req.log.info("Processing farmer summary calculations", {
      farmerAccountIds,
      requestId: req.id,
    });

    // Group incoming orders by farmer account
    const incomingByFarmer = incomingOrders.reduce((acc, order) => {
      const { farmerAccount, variety, size } = order._id;
      if (!acc[farmerAccount]) acc[farmerAccount] = {};
      if (!acc[farmerAccount][variety]) acc[farmerAccount][variety] = {};
      acc[farmerAccount][variety][size] = {
        initialQuantity: order.initialQuantity,
        currentQuantity: order.currentQuantity,
      };
      return acc;
    }, {});

    // Group outgoing orders by farmer account
    const outgoingByFarmer = outgoingOrders.reduce((acc, order) => {
      const { farmerAccount, variety, size } = order._id;
      if (!acc[farmerAccount]) acc[farmerAccount] = {};
      if (!acc[farmerAccount][variety]) acc[farmerAccount][variety] = {};
      if (!acc[farmerAccount][variety][size]) {
        acc[farmerAccount][variety][size] = { quantityRemoved: 0 };
      }
      acc[farmerAccount][variety][size].quantityRemoved = order.quantityRemoved;
      return acc;
    }, {});

    // Combine incoming and outgoing data for each farmer
    const allFarmersSummary = {};

    // Process all farmer account IDs (including those with no orders)
    for (const farmerAccountId of farmerAccountIds) {
      const incomingSummary = incomingByFarmer[farmerAccountId] || {};
      const outgoingSummary = outgoingByFarmer[farmerAccountId] || {};

      // Merge incoming and outgoing data
      const combinedSummary = { ...incomingSummary };

      // Add outgoing quantities to the combined summary
      Object.keys(outgoingSummary).forEach(variety => {
        if (!combinedSummary[variety]) combinedSummary[variety] = {};
        Object.keys(outgoingSummary[variety]).forEach(size => {
          if (!combinedSummary[variety][size]) {
            combinedSummary[variety][size] = {
              initialQuantity: 0,
              currentQuantity: 0,
            };
          }
          combinedSummary[variety][size].quantityRemoved = outgoingSummary[variety][size].quantityRemoved;
        });
      });

      // Convert the stock summary object into an array
      const stockSummaryArray = Object.entries(combinedSummary).map(
        ([variety, sizes]) => ({
          variety,
          sizes: Object.entries(sizes).map(([size, quantities]) => ({
            size,
            ...quantities,
          })),
        })
      );

      allFarmersSummary[farmerAccountId] = stockSummaryArray;
    }

    req.log.info("Successfully generated farmer stock summaries", {
      farmerAccountIds,
      farmersProcessed: Object.keys(allFarmersSummary).length,
      requestId: req.id,
    });

    reply.code(200).send({
      status: "Success",
      stockSummaries: allFarmersSummary,
    });
  } catch (err) {
    req.log.error("Error in farmer stock summary calculation", {
      error: err.message,
      stack: err.stack,
      farmerAccountIds: req.body.farmerAccountIds,
      coldStorageId: req.storeAdmin._id,
      requestId: req.id,
    });
    reply.code(500).send({
      status: "Fail",
      message: "Error occurred while calculating stock summaries",
      errorMessage: err.message,
    });
  }
};

const searchOrderByReceiptNumber = async (req, reply) => {
  try {
    const coldStorageId = req.storeAdmin._id;
    const { receiptNumber } = req.body;

    if (!receiptNumber) {
      req.log.warn("Receipt number not provided", { coldStorageId });
      return reply.code(400).send({
        status: "Fail",
        message: "Receipt number is required"
      });
    }

    req.log.info("Searching for order with receipt number", {
      receiptNumber,
      coldStorageId
    });

    // Search in both KapoorIncomingOrder and KapoorOutgoingOrder collections
    const [incomingOrders, outgoingOrders] = await Promise.all([
      KapoorIncomingOrder.find({
        coldStorageId,
        'voucher.voucherNumber': receiptNumber
      }).populate({
        path: 'farmerAccount',
        model: FarmerAccount,
        populate: {
          path: 'profile',
          model: 'FarmerProfile',
          select: 'name mobileNumber address'
        },
        select: 'farmerId variety profile'
      }),
      KapoorOutgoingOrder.find({
        coldStorageId,
        'voucher.voucherNumber': receiptNumber
      }).populate({
        path: 'farmerAccount',
        model: FarmerAccount,
        populate: {
          path: 'profile',
          model: 'FarmerProfile',
          select: 'name mobileNumber address'
        },
        select: 'farmerId variety profile'
      })
    ]);

    // If no orders found
    if (!incomingOrders.length && !outgoingOrders.length) {
      req.log.info("No orders found with receipt number", {
        receiptNumber,
        coldStorageId
      });
      return reply.code(404).send({
        status: "Fail",
        message: "No orders found with this receipt number"
      });
    }

    // Convert to plain objects and sort bag sizes for both types
    const processOrders = (orders) => {
      return orders.map(order => {
        const orderObject = order.toObject();

        // Transform farmerAccount to match the expected format
        const fa = orderObject.farmerAccount;
        const profile = fa?.profile || {};
        const baseAccount = {
          _id: fa._id,
          name: profile.name || "",
          address: profile.address || "",
          mobileNumber: profile.mobileNumber || "",
          farmerId: fa.farmerId,
        };

        // Replace the farmerAccount with the transformed baseAccount
        orderObject.farmerAccount = baseAccount;

        if (orderObject.orderDetails) {
          orderObject.orderDetails = orderObject.orderDetails.map(detail => ({
            ...detail,
            bagSizes: detail.bagSizes.sort((a, b) =>
              a.size.localeCompare(b.size)
            )
          }));
        }
        if (orderObject.incomingBagSizes) {
          orderObject.incomingBagSizes = orderObject.incomingBagSizes.sort((a, b) =>
            a.size.localeCompare(b.size)
          );
        }
        return orderObject;
      });
    };

    const processedIncomingOrders = processOrders(incomingOrders);
    const processedOutgoingOrders = processOrders(outgoingOrders);

    req.log.info("Successfully found orders", {
      receiptNumber,
      incomingCount: incomingOrders.length,
      outgoingCount: outgoingOrders.length
    });

    reply.code(200).send({
      status: "Success",
      data: {
        incoming: processedIncomingOrders,
        outgoing: processedOutgoingOrders
      }
    });

  } catch (err) {
    req.log.error("Error searching for orders", {
      error: err.message,
      stack: err.stack,
      receiptNumber: req.body?.receiptNumber,
      coldStorageId: req.storeAdmin._id
    });

    reply.code(500).send({
      status: "Fail",
      message: "Error occurred while searching for orders",
      errorMessage: err.message
    });
  }
};

export {
  quickRegisterFarmer,
  getKapoorColdStorageSummary,
  getFarmersIdsForCheck,
  getAllFarmerProfiles,
  getAccountsForFarmerProfile,
  searchFarmerProfiles,
  createIncomingOrder,
  editKapoorIncomingOrder,
  getReceiptVoucherNumbers,
  getKapoorDaybookOrders,
  getKapoorTopFarmers,
  getAllIncomingOrdersOfASingleFarmer,
  getAllOrdersOfASingleFarmer,
  searchKapoorOrdersByVariety,
  createOutgoingOrder,
  getFarmerStockSummary,
  searchOrderByReceiptNumber,
};
