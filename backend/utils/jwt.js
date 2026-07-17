const jwt = require("jsonwebtoken");

function generateAccessToken(user) {
    return jwt.sign(
        {
            id: user.id,
            email: user.email
        },
        process.env.JWT_SECRET,
        {
            expiresIn: process.env.JWT_EXPIRES_IN
        }
    );
}

function generateRefreshToken(user) {
    return jwt.sign(
        {
            id: user.id
        },
        process.env.JWT_REFRESH_SECRET,
        {
            expiresIn: process.env.JWT_REFRESH_EXPIRES_IN
        }
    );
}

module.exports = {
    generateAccessToken,
    generateRefreshToken
};