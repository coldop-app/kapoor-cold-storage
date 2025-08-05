// models/FarmerProfile.js
import mongoose from "mongoose";

const farmerProfileSchema = mongoose.Schema(
  {
    name: { type: String, required: true },
    fatherName: { type: String, required: true },
    address: { type: String, required: true },
    imageUrl: { type: String, default: "" },
    // optional mobile number
    mobileNumber: { type: String, required: false, unique: true, sparse: true },
  },
  { timestamps: true }
);

const FarmerProfile = mongoose.model("FarmerProfile", farmerProfileSchema);
export default FarmerProfile;
