import {
  loginSchema,
  storeAdminRegisterSchema,
  storeAdminUpdateSchmea,
  quickRegisterSchema,
  farmerIdSchema,
} from "../utils/validationSchemas.js";
import { formatFarmerName, formatName } from "../utils/helpers.js";
import bcrypt from "bcryptjs";
import FarmerProfile from "../models/farmerProfile.js";
import FarmerAccount from "../models/farmerAccount.js";
import StoreAdmin from "../models/storeAdminModel.js";
import KapoorIncomingOrder from "../models/kapoor-incoming-model.js";

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
    const farmerAccounts = await FarmerAccount.find({ storeAdmin: storeAdminId })
      .select('farmerId');

    // Extract unique farmerIds
    const usedFarmerIds = [...new Set(farmerAccounts.map(account => account.farmerId))];

    req.log.info("Retrieved farmer IDs for store admin", {
      storeAdminId,
      totalFarmers: usedFarmerIds.length
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
    const farmerAccounts = await FarmerAccount.find({ storeAdmin: storeAdminId })
      .select('profile');

    // Extract unique profile IDs
    const profileIds = [...new Set(farmerAccounts.map(account => account.profile))];

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

    if (!searchQuery || searchQuery.trim() === '') {
      return reply.code(400).send({
        status: "Fail",
        message: "Search query is required."
      });
    }

    const trimmedQuery = searchQuery.trim();

    // First, get all farmer accounts for this store admin
    const farmerAccounts = await FarmerAccount.find({ storeAdmin: storeAdminId })
      .select('profile');

    // Extract unique profile IDs
    const profileIds = [...new Set(farmerAccounts.map(account => account.profile))];

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
        { mobileNumber: { $regex: trimmedQuery, $options: "i" } }
      ]
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

    const {
      farmerAccount,
      variety,
      voucherNumber,
      incomingBagSizes,
      dateOfEntry,
      remarks,
    } = req.body;

    // Validate required fields
    if (!farmerAccount || !variety || !voucherNumber || !incomingBagSizes || !dateOfEntry) {
      return reply.code(400).send({
        status: "Fail",
        message: "Missing required fields: farmerAccount, variety, voucherNumber, incomingBagSizes, dateOfEntry",
      });
    }

    // Validate incomingBagSizes structure
    if (!Array.isArray(incomingBagSizes) || incomingBagSizes.length === 0) {
      return reply.code(400).send({
        status: "Fail",
        message: "incomingBagSizes must be a non-empty array",
      });
    }

    // Validate each bag size object
    for (const bagSize of incomingBagSizes) {
      if (!bagSize.size || !bagSize.quantity || !bagSize.location) {
        return reply.code(400).send({
          status: "Fail",
          message: "Each bag size must have size, quantity, and location fields",
        });
      }

      if (typeof bagSize.quantity !== 'number' || bagSize.quantity <= 0) {
        return reply.code(400).send({
          status: "Fail",
          message: "Quantity must be a positive number",
        });
      }
    }

    // Check if farmer account exists and belongs to this store admin
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

    // Check if voucher number already exists for this store
    const existingOrder = await KapoorIncomingOrder.findOne({
      coldStorageId: storeAdminId,
      "voucher.voucherNumber": voucherNumber,
    });

    if (existingOrder) {
      return reply.code(400).send({
        status: "Fail",
        message: "Voucher number already exists for this store",
      });
    }

    // Create the incoming order
    const newIncomingOrder = await KapoorIncomingOrder.create({
      coldStorageId: storeAdminId,
      farmerAccount: farmerAccount,
      variety: variety,
      voucher: {
        type: "RECEIPT",
        voucherNumber: voucherNumber,
      },
      incomingBagSizes: incomingBagSizes,
      dateOfEntry: dateOfEntry,
      remarks: remarks || "",
      createdBy: storeAdminId,
    });

    req.log.info("Incoming order created successfully", {
      orderId: newIncomingOrder._id,
      storeAdminId: storeAdminId,
      farmerAccount: farmerAccount,
      voucherNumber: voucherNumber,
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

const getReceiptVoucherNumbers = async (req, reply) => {
  try {
    const storeAdminId = req.storeAdmin._id;

    // Get all receipt voucher numbers for this cold storage
    const voucherNumbers = await KapoorIncomingOrder.find({
      coldStorageId: storeAdminId,
    })
    .select('voucher.voucherNumber voucher.type dateOfEntry variety')
    .sort({ 'voucher.voucherNumber': 1 });

    req.log.info("Retrieved receipt voucher numbers successfully", {
      storeAdminId: storeAdminId,
      count: voucherNumbers.length,
    });

    return reply.code(200).send({
      status: "Success",
      receiptNumber: voucherNumbers.length
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

const getKapoorIncomingOrders = async (req, reply) => {
  try {
    const coldStorageId = req.storeAdmin._id;
    const { sortBy } = req.query;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const sortOrder = sortBy === "latest" ? -1 : 1;

    const skip = (page - 1) * limit;

    // Helper function to sort bag sizes
    const sortOrderDetails = (orders) => {
      return orders.map((order) => {
        const orderObj = order.toObject();
        if (orderObj.incomingBagSizes) {
          orderObj.incomingBagSizes = orderObj.incomingBagSizes.sort((a, b) =>
            a.size.localeCompare(b.size)
          );
        }
        return orderObj;
      });
    };

    // Helper function to create pagination metadata
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

    req.log.info("Getting kapoor incoming orders", {
      coldStorageId,
      sortBy,
      page,
      limit,
      sortOrder
    });

    // Get total count for pagination
    const totalCount = await KapoorIncomingOrder.countDocuments({ coldStorageId });

    if (totalCount === 0) {
      req.log.info("No incoming orders found for the cold storage");
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
          select: "name mobileNumber address"
        },
        select: "farmerId variety profile"
      })
      .select(
        "_id coldStorageId remarks farmerAccount variety voucher incomingBagSizes dateOfEntry createdAt"
      );

    const sortedOrders = sortOrderDetails(incomingOrders);

    req.log.info("Kapoor incoming orders retrieved successfully", {
      count: sortedOrders.length,
      totalCount
    });

    reply.code(200).send({
      status: "Success",
      data: sortedOrders,
      pagination: createPaginationMeta(totalCount, page, limit),
    });

  } catch (err) {
    req.log.error("Error getting kapoor incoming orders:", {
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
          select: "name mobileNumber address"
        },
        select: "farmerId variety profile"
      })
      .select(
        "_id coldStorageId remarks farmerAccount variety voucher incomingBagSizes dateOfEntry createdAt"
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

export { quickRegisterFarmer, getFarmersIdsForCheck, getAllFarmerProfiles, getAccountsForFarmerProfile, searchFarmerProfiles, createIncomingOrder, getReceiptVoucherNumbers, getKapoorIncomingOrders, getAllIncomingOrdersOfASingleFarmer };
