const User = require("../models/userModel");

exports.getUsers = async (req, res) => {

    try {

        const users = await User.getAll();

        res.json(users);

    } catch (error) {

        console.error(error);

        res.status(500).json({
            error: "Internal Server Error"
        });

    }

};