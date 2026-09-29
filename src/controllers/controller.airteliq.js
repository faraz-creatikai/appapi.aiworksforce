import { getAccessToken } from "../config/airteliq.js";



export const makeAirtelCall = async (req, res, next) => {
     const token = await getAccessToken();
     
    try {
       

        const res = await fetch("https://openapi.airtel.in/v1/calls", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${token}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                from: "917878172452",
                to: "919001454076",
                callbackUrl: "https://yourdomain.com/webhook"
            })
        });

        const data = await res.json();
        console.log(data);
        res.json(data);
    }
    catch (err) {
        console.log(" token ",token)
        console.error("Error making Airtel IQ call:", err);
        res.status(500).json({ error: "Failed to make call" });
    }
};