const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const jwt = require("jsonwebtoken");
const app = express();
app.use(express.json());
const port = process.env.PORT || 5000;
app.use(cors());
app.use(express.json());
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.q1ga5lh.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverApi: ServerApiVersion.v1,
});
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const verifyJWT = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).send("unauthorized access");
  }
  const token = authHeader.split(" ")[1];
  jwt.verify(token, process.env.JWT_ACCESS_TOKEN, function (err, decoded) {
    if (err) {
      return res.status(403).send({ message: "forbidden access" });
    }
    req.decoded = decoded;
    next();
  });
};

async function run() {
  try {
    const usersCollection = client.db("resaleStore").collection("users");
    const productsCollection = client.db("resaleStore").collection("products");
    const categoriesCollection = client
      .db("resaleStore")
      .collection("categories");
    const orderCollection = client.db("resaleStore").collection("orders");
    const reportsCollection = client.db("resaleStore").collection("reports");
    const paymentsCollection = client.db("resaleStore").collection("payments");
    const verifySeller = async (req, res, next) => {
      const decodedEmail = req.decoded.email;
      const query = { email: decodedEmail };
      const user = await usersCollection.findOne(query);
      if (user?.role !== "seller") {
        return res
          .status(403)
          .send({ message: "forbidden access", success: false });
      }
      next();
    };
    const verifyBuyer = async (req, res, next) => {
      const decodedEmail = req.decoded.email;
      const query = { email: decodedEmail };
      const user = await usersCollection.findOne(query);
      if (user?.role !== "buyer") {
        return res
          .status(403)
          .send({ message: "forbidden access", success: false });
      }
      next();
    };
    app.post("/create-payment-intent", async (req, res) => {
      const { price } = req.body;
      const amount = price * 100;

      // Create a PaymentIntent with the order amount and currency
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: "usd",
        payment_method_types: ["card"],
      });

      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    });
    app.post("/payment", async (req, res) => {
      const payment = req.body;
      const result = await paymentsCollection.insertOne(payment);
      //order status update
      const orderId = payment.orderId;
      const filter = { _id: ObjectId(orderId) };
      const options = {
        upsert: true,
      };
      const updateDoc = {
        $set: {
          paid: true,
          transactionId: payment.transactionId,
        },
      };
      const orderResult = await orderCollection.updateOne(
        filter,
        updateDoc,
        options
      );
      //product status update
      const productId = payment.productId;
      const productFilter = { _id: ObjectId(productId) };
      const productOptions = {
        upsert: true,
      };
      const productUpdateDoc = {
        $set: {
          status: "sold",
        },
      };
      const productResult = await productsCollection.updateOne(
        productFilter,
        productUpdateDoc,
        productOptions
      );
      res.send(result);
    });
    app.get("/jwt", async (req, res) => {
      const email = req.query.email;
      const query = { email: email };
      const user = await usersCollection.findOne(query);
      if (user) {
        const token = jwt.sign({ email }, process.env.JWT_ACCESS_TOKEN, {
          expiresIn: "10d",
        });
        return res.send({ accessToken: token });
      } else {
        res.status(403).send("unauthorized access");
      }
    });
    app.post("/report", async (req, res) => {
      const report = req.body;
      report.created_at = new Date();
      const result = await reportsCollection.insertOne(report);
      res.send(result);
    });
    app.get("/report", async (req, res) => {
      const query = {};
      const result = await reportsCollection.find(query).toArray();
      res.send(result);
    });
    app.delete("/report/product/:id", async (req, res) => {
      const id = req.params.id;
      const filter = { _id: ObjectId(id) };
      const result = await productsCollection.deleteOne(filter);
      res.send(result);
    });
    app.post("/order", async (req, res) => {
      const order = req.body;
      order.created_at = new Date();
      const result = await orderCollection.insertOne(order);
      res.send(result);
    });
    app.get("/orders", verifyJWT, verifyBuyer, async (req, res) => {
      const email = req.query.email;
      const query = { email: email };
      const result = await orderCollection.find(query).toArray();
      res.send(result);
    });
    app.get("/orders/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: ObjectId(id) };
      const result = await orderCollection.findOne(query);
      res.send(result);
    });
    app.get("/categories", async (req, res) => {
      const query = {};
      const categories = await categoriesCollection.find(query).toArray();
      res.send(categories);
    });
    app.get("/category/:id", async (req, res) => {
      const id = req.params.id;
      const result = await productsCollection
        .find({
          $and: [{ category: { $eq: id } }, { status: { $eq: "available" } }],
        })
        .toArray();
      res.send(result);
    });
    app.get("/users/seller/:email", async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const user = await usersCollection.findOne(query);
      res.send({ isSeller: user?.role === "seller" });
    });
    app.get("/users/admin/:email", async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const user = await usersCollection.findOne(query);
      res.send({ isAdmin: user?.role === "admin" });
    });
    app.get("/users/buyer/:email", async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const user = await usersCollection.findOne(query);
      res.send({ isBuyer: user?.role === "buyer" });
    });
    app.get("/users/verified/:email", async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const user = await usersCollection.findOne(query);
      res.send({ isVerified: user?.verified === true });
    });
    app.post("/users", async (req, res) => {
      const user = req.body;
      const query = { email: user.email };
      const search = await usersCollection.findOne(query);
      if (!search) {
        user.created_at = new Date();
        const result = await usersCollection.insertOne(user);
        res.send(result);
      } else {
        res.send(search);
      }
    });
    app.delete("/user/delete/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: ObjectId(id) };
      const result = await usersCollection.deleteOne(query);
      res.send(result);
    });
    app.get("/sellers", async (req, res) => {
      const query = { role: "seller" };
      const result = await usersCollection.find(query).toArray();
      res.send(result);
    });
    app.get("/buyers", async (req, res) => {
      const query = { role: "buyer" };
      const result = await usersCollection.find(query).toArray();
      res.send(result);
    });
    app.post("/add-product", verifyJWT, async (req, res) => {
      const productInfo = req.body;
      productInfo.created_at = new Date();
      const result = await productsCollection.insertOne(productInfo);
      res.send(result);
    });
    app.get("/my-products", async (req, res) => {
      const email = req.query.email;
      const query = { sellerEmail: email };
      const result = await productsCollection.find(query).toArray();
      res.send(result);
    });
    app.get("/advertised-products", async (req, res) => {
      const result = await productsCollection
        .find({
          $and: [
            { advertised: { $eq: true } },
            { status: { $eq: "available" } },
          ],
        })
        .toArray();
      res.send(result);
    });
    app.put(
      "/product/advertise/:id",
      verifyJWT,
      verifySeller,
      async (req, res) => {
        const id = req.params.id;
        const filter = { _id: ObjectId(id) };
        const search = await productsCollection.findOne(filter);
        if (!search.advertised) {
          const options = { upsert: true };
          const updatedDoc = {
            $set: {
              advertised: true,
            },
          };
          const updatedResult = await productsCollection.updateOne(
            filter,
            updatedDoc,
            options
          );
          res.send({ updatedResult, advertised: true });
        } else {
          const options = { upsert: true };
          const updatedDoc = {
            $set: {
              advertised: false,
            },
          };
          const updatedResult = await productsCollection.updateOne(
            filter,
            updatedDoc,
            options
          );
          res.send({ updatedResult, advertised: false });
        }
      }
    );
    app.put("/user/verify/:id", async (req, res) => {
      const id = req.params.id;
      const filter = { _id: ObjectId(id) };
      const options = { upsert: true };
      const updatedDoc = {
        $set: {
          verified: true,
        },
      };
      const updatedResult = await usersCollection.updateOne(
        filter,
        updatedDoc,
        options
      );
      res.send(updatedResult);
    });
    app.delete("/product/delete/:id", async (req, res) => {
      const id = req.params.id;
      const filter = { _id: ObjectId(id) };
      const result = await productsCollection.deleteOne(filter);
      res.send(result);
    });
    // app.get("/addPrice", async (req, res) => {
    //   const filter = {};
    //   const options = { upsert: true };
    //   const updatedDoc = {
    //     $set: {
    //       advertise: "false",
    //     },
    //   };
    //   const result = await productsCollection.updateMany(
    //     filter,
    //     updatedDoc,
    //     options
    //   );
    //   res.send(result);
    // });
  } finally {
  }
}
run().catch(console.dir);
app.get("/", (req, res) =>
  res.send("Md Suzayet Hossan, your resale store server is running.")
);
app.listen(port, () => {
  client.connect((err) => {
    if (err) {
      console.log(err);
    } else {
      console.log("Connected to MongoDB");
    }
  });
});
