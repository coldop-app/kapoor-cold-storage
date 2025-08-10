// models/kapoor-outgoing-order-model.js

import mongoose from "mongoose";

// Each bag size comes with quantity removed AND location
const bagSizeSchema = new mongoose.Schema(
  {
    _id: false,
    size: {
      type: String,
      required: true,
    },
    quantityRemoved: {
      type: Number,
      required: true,
    },
    location: {
      type: String,
      required: true,
    },
  },
  { _id: false }
);

// Order detail referencing a specific incoming order
const orderDetailsSchema = new mongoose.Schema(
  {
    _id: false,

    variety: {
      type: String,
      required: true,
    },

    incomingOrder: {
      _id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "KapoorIncomingOrder", // ✅ specific incoming model
        required: true,
      },
      voucher: {
        type: {
          type: String,
          required: true,
        },
        voucherNumber: {
          type: Number,
          required: true,
        },
      },
      incomingBagSizes: [
        {
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
      ],
    },

    bagSizes: [bagSizeSchema],
  },
  { _id: false }
);

// Outgoing order schema
const kapoorOutgoingOrderSchema = new mongoose.Schema(
  {
    coldStorageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "StoreAdmin",
      required: true,
    },

    farmerAccount: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "FarmerAccount", // ✅ consistent with incoming model
      required: true,
    },

    voucher: {
      type: {
        type: String,
        default: "DELIVERY",
        required: true,
      },
      voucherNumber: {
        type: Number,
        required: true,
      },
    },

    dateOfExtraction: {
      type: String,
      required: true,
    },

    currentStockAtThatTime: {
      type: Number,
      required: true,
    },

    remarks: {
      type: String,
    },

    orderDetails: [orderDetailsSchema],

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "StoreAdmin",
      required: true,
    },
  },
  { timestamps: true }
);

const KapoorOutgoingOrder = mongoose.model(
  "KapoorOutgoingOrder",
  kapoorOutgoingOrderSchema
);

export default KapoorOutgoingOrder;
