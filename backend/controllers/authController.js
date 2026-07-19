const User = require("../models/userModel");

exports.login = async (req, res) => {

    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({
            error: "Email and password are required"
        });
    }

    try {

        const user = await User.findByEmail(email);

        if (!user || user.password !== password) {
            return res.status(401).json({
                error: "Invalid email or password"
            });
        }

        res.status(200).json({
            accessToken: "mockAccessToken",
            refreshToken: "mockRefreshToken"
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            error: "Internal Server Error"
        });

    }

};

exports.signup = async (req, res) => {

    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({
            error: "Email and password are required"
        });
    }

    try {

        const user = await User.create(email, password);

        res.status(201).json(user);

    } catch (error) {

        console.error(error);

        res.status(500).json({
            error: "Internal Server Error"
        });

    }

};