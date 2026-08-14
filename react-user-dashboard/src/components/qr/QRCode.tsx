interface QRCodeProps {
    qrImage: string;
}


function QRCode({ qrImage }: QRCodeProps) {

    return (

        <div className="mx-auto mt-7 mb-4.5 grid aspect-square w-[min(17.5rem,100%)] place-items-center rounded-xl border border-[var(--hairline-strong)] bg-white p-4.5">

            <img
                src={qrImage}
                alt="Participant QR Code"
                className="block size-full object-contain"
            />

        </div>

    );

}


export default QRCode;
