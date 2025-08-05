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
    // Get the store admin document with populated registeredFarmers
    const storeAdmin = await StoreAdmin.findById(req.storeAdmin._id);

    // Filter out any non-existent farmers and get their IDs
    const validFarmerIds = [];
    const invalidFarmerIds = [];

    for (const farmerId of storeAdmin.registeredFarmers) {
      const farmerAccountExists = await FarmerAccount.findById(farmerId);
      if (farmerAccountExists) {
        validFarmerIds.push(farmerAccountExists.farmerId);
      } else {
        invalidFarmerIds.push(farmerId);
      }
    }

    // If there were any invalid IDs, remove them from the store admin's registeredFarmers
    if (invalidFarmerIds.length > 0) {
      await StoreAdmin.findByIdAndUpdate(req.storeAdmin._id, {
        $pull: { registeredFarmers: { $in: invalidFarmerIds } },
      });
    }

    reply.code(200).send({
      status: "Success",
      data: {
        registeredFarmers: validFarmerIds,
      },
    });
  } catch (err) {
    reply.code(500).send({
      status: "Fail",
      message: err.message,
    });
  }
};

const getAllFarmerProfiles = async (req, reply) => {
  try {
    const profiles = await FarmerProfile.find({});
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
    const { name, fatherName, mobileNumber } = req.query;
    const query = {};
    if (name) {
      query.name = { $regex: name, $options: "i" };
    }
    if (fatherName) {
      query.fatherName = { $regex: fatherName, $options: "i" };
    }
    if (mobileNumber) {
      query.mobileNumber = { $regex: mobileNumber, $options: "i" };
    }
    if (Object.keys(query).length === 0) {
      return reply.code(400).send({
        status: "Fail",
        message: "At least one search parameter (name, fatherName, mobileNumber) is required."
      });
    }
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

export { quickRegisterFarmer, getFarmersIdsForCheck, getAllFarmerProfiles, getAccountsForFarmerProfile, searchFarmerProfiles };
