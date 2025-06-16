const functions = require("firebase-functions");
const admin = require("firebase-admin");
const {
  updateUser,
  createUser,
  createDepartments,
} = require("./authentication");
const { doBilling } = require("./billing");
const cors = require("cors");
const { validateInventoryFields } = require("./validator");
require("firebase-functions/logger/compat");
const path = require("path");
const fs = require("fs");

admin.initializeApp();

const db = admin.firestore();

// const corsMiddleware = cors({
//     origin: "http://localhost:3000",
// });

exports.updateUser = updateUser;
exports.createUser = createUser;
exports.doBilling = doBilling;
exports.createDepartments = createDepartments;

exports.login = functions.https.onRequest(
  { cors: [/firebase\.com$/, "http://localhost:3000",'https://imagine-bc615.web.app'] },

  async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).send({ error: "Email and password are required" });
      return;
    }

    try {
      const user = await admin.auth().getUserByEmail(email);
      // Perform additional logic like password verification here
      res.status(200).send({ message: "Login successful", user });
    } catch (error) {
      console.error("Error during login:", error);
      res.status(500).send({ error: "An error occurred during login" });
    }
  }
);

// exports.addSerial = functions.https.onRequest(async (req, res) => {
//     try {
//       // Load the JSON file
//       const filePath = path.join(__dirname, "data.json");
//       const jsonData = JSON.parse(fs.readFileSync(filePath, "utf-8"));

//       // Ensure the JSON has the expected structure
//       if (!jsonData.barcodes || !Array.isArray(jsonData.barcodes)) {
//         throw new Error("Invalid JSON structure. Expected 'barcodes' array.");
//       }
//       const barcodes = jsonData.barcodes;
//       const chunkSize = 500;
//       for (let i = 0; i < barcodes.length; i += chunkSize) {
//         const chunk = barcodes.slice(i, i + chunkSize); // Split into chunks of 500

//         const batch = db.batch();
//         chunk.forEach((barcode) => {
//           const docRef = db.collection("barcodes").doc(barcode); // Document ID is the barcode
//           batch.set(docRef, { barcode }); // Store the barcode in the document
//         });

//         await batch.commit(); // Commit the current batch
//         console.log(`Batch ${i / chunkSize + 1} committed successfully.`);
//       }

//       res.status(200).send("Serial numbers successfully added to Firestore.");
//     } catch (error) {
//       console.error("Error adding serial numbers:", error);
//       res.status(500).send("Error adding serial numbers: " + error.message);
//     }
//   });

// exports.getInventory = functions.https.onRequest((req, res) => {
//     corsMiddleware(req, res, async () => {
//         try {
//             // Fetch the 'inventory' collection
//             const inventoryCollection = await db.collection("inventory").get();

//             // Map the documents to an array of data
//             const inventoryData = inventoryCollection.docs.map(doc => ({
//                 id: doc.id, // Add the document ID
//                 ...doc.data(), // Include the document fields
//             }));

//             // Send the response
//             res.status(200).json({ success: true, data: inventoryData });
//         } catch (error) {
//             console.error("Error fetching inventory:", error);
//             res.status(500).json({ success: false, message: error.message });
//         }

//     })
// })

// exports.getTransactions = functions.https.onRequest(async (req, res) => {
//     corsMiddleware(req, res, async () => {
//         try {
//             const transactions = await db.collection("transactions").get()
//             const transactionData = transactions.docs.map(doc => ({
//                 id: doc.id,
//                 ...doc.data(),
//             }))
//             res.status(200).json({ success: true, data: transactionData });
//         } catch (error) {
//             console.error("Error fetching inventory:", error);
//             res.status(500).json({ success: false, message: error.message });
//         }
//     })

// })

exports.getRetailer = functions.https.onRequest(
  { cors: [/firebase\.com$/, "http://localhost:3000",'https://imagine-bc615.web.app'] },
  async (req, res) => {
    const id = req.query.id;
    if (!id) {
      return res
        .status(400)
        .json({ success: false, message: "Retailer ID is required" });
    }

    try {
      // Fetch the 'inventory' collection
      const retailerDoc = await db.collection("users").doc(id).get();
      if (!retailerDoc.exists) {
        return res
          .status(404)
          .json({ success: false, message: "Retailer not found" });
      }
      // Map the documents to an array of data
      const retailerData = {
        id: retailerDoc.id,
        ...retailerDoc.data(),
      };

      // Send the response
      res.status(200).json({ success: true, data: retailerData });
    } catch (error) {
      console.error("Error fetching inventory:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  }
);

exports.addInventory = functions.https.onRequest(
  { cors: [/firebase\.com$/, "http://localhost:3000",'https://imagine-bc615.web.app'] },
  async (req, res) => {
    const {
      brand,
      model,
      variant,
      condition,
      imei_1,
      imei_2,
      purchasePrice,
      sellingPrice,
      notes,
    } = req.body;

    // Validate required fields
    const validationError = validateInventoryFields({
      brand,
      model,
      variant,
      condition,
      imei_1,
      imei_2,
    });
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError });
    }

    try {
      // Fetch the barcode document
      const barcodeDocRef = db.collection("barcode").doc("barcode");
      const barcodeSnapshot = await barcodeDocRef.get();

      // Check if the barcode document exists
      if (!barcodeSnapshot.exists) {
        return res
          .status(400)
          .json({ success: false, message: "Barcode document not found" });
      }

      // Get the current highest barcode value
      const currentBarcode = barcodeSnapshot.data().current;
      console.log("Current Barcode:", currentBarcode);

      // Increment the barcode
      const newSerial = incrementBarcode(currentBarcode);
      console.log("New Serial Number:", newSerial);

      // Update the barcode document with the new serial number
      await barcodeDocRef.update({ current: newSerial });

      // Create the inventory data
      const inventoryData = {
        brand,
        model,
        variant,
        condition,
        imei_1,
        imei_2,
        purchasePrice,
        sellingPrice,
        notes,
        serialNumber: newSerial,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        status: {
          INVENTORY: admin.firestore.FieldValue.serverTimestamp(),
        },
      };

      // Add the inventory data to the collection
      await db.collection("all-products").doc(newSerial).set(inventoryData);

      return res.status(201).json({
        success: true,
        message: "Inventory added successfully",
        data: inventoryData,
      });
    } catch (error) {
      console.error("Error adding inventory:", error);
      return res
        .status(500)
        .json({ success: false, message: "Error adding inventory" });
    }
  }
);
function incrementBarcode(currentBarcode) {
  // Extract the numeric part of the barcode
  const numericPart = parseInt(currentBarcode.slice(3));
  const nextNumericPart = numericPart + 1;

  // Create the next barcode value
  const nextBarcode = `IMG${String(nextNumericPart).padStart(9, "0")}`;
  return nextBarcode;
}
