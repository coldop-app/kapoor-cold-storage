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
import { getDeliveryVoucherNumberHelper, getReceiptNumberHelper,formatDate, formatFarmerName } from "../utils/helpers.js";

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
      incomingBagSizes,
      remarks,
    } = req.body;

    if (!farmerAccount || !variety || !incomingBagSizes) {
      return reply.code(400).send({
        status: "Fail",
        message: "Missing required fields: farmerAccount, variety, incomingBagSizes",
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
          message: "Each bag size must have size, quantity (with initial and current), and location",
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
    });

    req.log.info("Incoming order created successfully", {
      orderId: newIncomingOrder._id,
      storeAdminId,
      farmerAccount,
      voucherNumber: receiptNumber,
      currentStockAtThatTime,
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
          select: "name mobileNumber address"
        },
        select: "farmerId variety profile"
      })
      .select(
        "_id coldStorageId remarks farmerAccount variety voucher incomingBagSizes dateOfEntry currentStockAtThatTime createdAt"
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

        if (!update.size || !update.location || typeof update.quantityToRemove !== "number") {
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
              availableBags: matchingDetail.bagSizes.map((b) => ({ size: b.size, location: b.location })),
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
          mappedIncomingBagSizes: fetchedOrder.incomingBagSizes.map(bag => ({
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
          totalCurrentQuantity: { $sum: "$incomingBagSizes.quantity.currentQuantity" }, // 🔧 FIXED: Access nested currentQuantity
        },
      },
    ]);

    console.log("Total incoming stock aggregation result:", totalIncomingStock);
    console.log("Total incoming stock value:", totalIncomingStock.length > 0 ? totalIncomingStock[0].totalCurrentQuantity : 0);

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
    const incomingTotal = totalIncomingStock.length > 0 ? totalIncomingStock[0].totalCurrentQuantity : 0;
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
    
    const outgoingOrderDetails = orders.map(({ orderId, variety, bagUpdates }) => {
      console.log("Processing variety:", variety);

      const bagSizes = bagUpdates
        .filter((u) => u.quantityToRemove > 0) // Filter out zero quantities
        .map(({ size, location, quantityToRemove }) => {
          console.log("Processing bag update:", { size, location, quantityToRemove, variety });

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
                  "incomingBagSizes.$.quantity.currentQuantity": -quantityToRemove, // 🔧 FIXED: Target nested currentQuantity
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
          incomingBagSizes: incomingOrderMap[orderId]?.mappedIncomingBagSizes || [],
        },
        bagSizes,
      };
    });

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



export { quickRegisterFarmer, getFarmersIdsForCheck, getAllFarmerProfiles, getAccountsForFarmerProfile, searchFarmerProfiles, createIncomingOrder, getReceiptVoucherNumbers, getKapoorDaybookOrders, getAllIncomingOrdersOfASingleFarmer, createOutgoingOrder};
