// models/kapoor-incoming-order-model.js

import mongoose from "mongoose";

// Each bag size comes with its own location
const incomingBagSizeSchema = new mongoose.Schema(
  {
    _id: false,
    size: {
      type: String,
      required: true,
    },
   quantity: {
        initialQuantity: {
          type: Number,
          required: true,
        },
        currentQuantity: {
          type: Number,
          required: true,
        },
      },
    location: {
      type: String,
      required: true,
    },
  },
  { _id: false }
);

const kapoorIncomingOrderSchema = new mongoose.Schema(
  {
    coldStorageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "StoreAdmin",
      required: true,
    },

    farmerAccount: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "FarmerAccount", // ✅ reference to specific account (not just profile)
      required: true,
    },

    variety: {
      type: String,
      required: true,
    },

    voucher: {
      type: {
        type: String,
        default: "RECEIPT",
        required: true,
      },
      voucherNumber: {
        type: Number,
        required: true,
      },
    },

    incomingBagSizes: [incomingBagSizeSchema], // ✅ includes location per size

    dateOfEntry: {
      type: String,
      required: true,
    },

    remarks: {
      type: String,
    },
      currentStockAtThatTime: {
      type: Number,
      required: true,
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "StoreAdmin",
      required: true,
    },
  },
  { timestamps: true }
);

const KapoorIncomingOrder = mongoose.model(
  "KapoorIncomingOrder",
  kapoorIncomingOrderSchema
);

export default KapoorIncomingOrder;
