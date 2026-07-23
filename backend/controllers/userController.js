const User = require("../models/userModel");


// ==========================================
// Create Staff User
// POST /users
// ==========================================
exports.createUser = async (req, res) => {

    try {

        const {
            fullName,
            email,
            employeeNumber,
            contactNumber,
            department,
            designation
        } = req.body;


        // Validate input
        if (!fullName || !email || !employeeNumber) {

            return res.status(400).json({
                success: false,
                message: "Full name, email and employee number are required"
            });

        }


        // Check if email already exists
        const existingUser = await User.findByEmail(email);


        if (existingUser) {

            return res.status(409).json({
                success: false,
                message: "Email already registered"
            });

        }


        // Create staff user
        const newUser = await User.create({

            fullName,
            email,
            employeeNumber,
            contactNumber,
            department,
            designation,
            status: "ACTIVE"

        });


        res.status(201).json({

            success: true,
            message: "Staff user created successfully",
            data: newUser

        });



    } catch (error) {

        console.error("Create user error:", error);


        res.status(500).json({

            success: false,
            message: "Internal Server Error"

        });

    }

};





// ==========================================
// Get All Users
// GET /users
// ==========================================
exports.getUsers = async (req, res) => {

    try {

        const users = await User.getAll();


        res.status(200).json({

            success: true,
            data: users

        });


    } catch (error) {

        console.error("Get users error:", error);


        res.status(500).json({

            success: false,
            message: "Internal Server Error"

        });

    }

};