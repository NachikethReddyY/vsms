interface QRCodeProps {
    qrImage: string;
}


function QRCode({ qrImage }: QRCodeProps) {

    return (

        <div className="qr-image-container">

            <img
                src={qrImage}
                alt="Participant QR Code"
                className="qr-image"
            />

        </div>

    );

}


export default QRCode;