import {default as WebServer, Middleware} from "../WebServer";
import UserSessionSchema from "../../db/schema/UserSessionSchema";
import {mongo} from "../../start";

export default class AuthMiddleware extends Middleware {
    middleware(server: WebServer): (req, res, next: () => void) => void {
        return (req, res, next) => {
            // check for the session cookies
            // todo: OAuth and Basic Authorization
            let icetea_session_token = req.cookies['icetea_session_token'];
            if (!icetea_session_token) {
                next();
                return;
            }
            // find the session
            let session = new UserSessionSchema();
            session.read({token: icetea_session_token});
            mongo.getOne(session, (err, session) => {
                if (err) {
                    console.error(err);
                    next();
                    return;
                }
                if (!session) {
                    // no session matches the token
                    console.log('received an unknown session token, ignoring.');
                    next();
                    return;
                }
                console.log('found session, userID=' + session.userId.toHexString());
                req._icetea['user_id'] = session.userId.toHexString();
                req._icetea['session_expired'] = false;
                if (session.isExpired()) {
                    req._icetea['session_expired'] = true;
                    // delete the session
                    mongo.deleteOne(session, (err, deleteResult) => {
                        if (err) {
                            console.error("Failed to delete expired session.");
                            console.error(err);
                        } else {
                            console.log("Deleted " + deleteResult.deletedCount + " session");
                        }
                        next();
                    });
                    return;
                }
                // renew the token
                session.renew((err, newExpirationTimestamp) => {
                    if (err) {
                        console.error('Failed to renew session');
                        console.error(err);
                        next();
                        return;
                    }
                    // update the session in the database
                    mongo.updateOne(session, {expirationTimestamp: newExpirationTimestamp}, (err, _) => {
                        if (err) {
                            console.error("Failed to update session expiration.");
                            console.error(err);
                            next();
                            return;
                        }
                        // update the cookie
                        res.cookie('icetea_session_token', session.token.toString('hex'), {
                            expires: new Date(newExpirationTimestamp)
                        });
                        next();
                    });
                });
            });
        };
    }
}