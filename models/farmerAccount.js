// models/FarmerAccount.js
import mongoose from "mongoose";

const farmerOrderSchema = mongoose.Schema({
  storeAdminId: { type: String, required: true },
  dateOfSubmission: { type: Date, default: Date.now },
  variety: { type: String, required: true },
  typeOfBag: { type: String, required: true },
  lotNumber: { type: String, required: true },
  quantity: { type: Number, required: true },
  floor: { type: String, required: true },
  row: { type: String, required: true },
  chamber: { type: String, required: true },
  isPaid: { type: Boolean, default: false },
});

const farmerAccountSchema = mongoose.Schema(
  {
    profile: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "FarmerProfile",
      required: true,
    },
    storeAdmin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "StoreAdmin",
      required: true,
    },
    variety: {
      type: String,
      required: true,
    },
    farmerId: {
      type: String,
      required: true,
    },
    password: {
      type: String,
      required: true,
    },
    farmerOrders: [farmerOrderSchema],
    isVerified: {
      type: Boolean,
      default: true,
    },
    role: {
      type: String,
      enum: ["user"],
      default: "user",
    },
    forgotPasswordToken: String,
    forgotPasswordTokenExpiry: Date,
  },
  { timestamps: true }
);

// Ensures uniqueness per person-variety-cold storage
farmerAccountSchema.index(
  { profile: 1, storeAdmin: 1, variety: 1 },
  { unique: true }
);

const FarmerAccount = mongoose.model("FarmerAccount", farmerAccountSchema);
export default FarmerAccount;
