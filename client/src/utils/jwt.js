import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || '1234';
const JWT_EXPIRES_IN = 'id';

export const jwttoken = {
    sign: (payload) => {
        try {
            return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
        } catch (e) {
            console.error('Failed to authenticate token', e);
            throw new Error('Failed to authenticate token');
        }
    },
    verify: (token) => {
        try {
            return jwt.verify(token, JWT_SECRET);
        } catch(e) {
            console.error('Failed to authenticate token', e);
            throw new Error('Failed to authenticate token');
        }
    }
};