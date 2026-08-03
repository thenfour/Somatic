// mdi/js icons browse @ https://pictogrammers.com/library/mdi/
import React from "react";
import {
    mdiAlphaACircle,
    mdiAlphaBCircle,
    mdiAlphaCCircle,
    mdiAlphaDCircle,
    mdiArrowUp,
    mdiAsterisk,
    mdiCardsClub,
    mdiCardsDiamond,
    mdiCardsSpade,
    mdiCheck,
    mdiCloseCircleOutline,
    mdiExclamationThick,
    mdiFlagVariant,
    mdiFire,
    mdiFlask,
    mdiHeart,
    mdiHelp,
    mdiLightningBolt,
    mdiMinusCircle,
    mdiPencil,
    mdiPlay,
    mdiPlusCircle,
    mdiStar,
    mdiTrashCanOutline,
} from "@mdi/js";
import Icon from "@mdi/react";
import { SongOrderMarkerVariant, SongOrderMarkerVariantValues } from "../models/songOrder";
import { DesktopMenu } from "./DesktopMenu/DesktopMenu";
import { BravuraMarkerIcon, HairpinMarkerIcon } from "./SongOrderMusicMarkerIcons";

import "./SongOrderMarker.css";

interface SongOrderMarkerControlProps {
    value: SongOrderMarkerVariant;
    className?: string;
    style?: React.CSSProperties;
};

export const SongOrderMarkerValue: React.FC<SongOrderMarkerControlProps> = (props) => {
    const { value, className, style } = props;

    const innerContent = (() => {
        switch (value) {
            default:
            case "default":
                return <div className="marker-icon default-icon"><Icon path={mdiPlay} size={1} /></div>;
            case "star":
                return <div className="marker-icon star-icon"><Icon path={mdiStar} size={1} /></div>;
            case "question":
                return <div className="marker-icon question-icon"><Icon path={mdiHelp} size={1} /></div>;
            case "exclamation":
                return <div className="marker-icon exclamation-icon"><Icon path={mdiExclamationThick} size={1} /></div>;
            case "check":
                return <div className="marker-icon check-icon"><Icon path={mdiCheck} size={1} /></div>;
            case "pencil":
                return <div className="marker-icon pencil-icon"><Icon path={mdiPencil} size={1} /></div>;
            case "flask":
                return <div className="marker-icon flask-icon"><Icon path={mdiFlask} size={1} /></div>;
            case "flag":
                return <div className="marker-icon flag-icon"><Icon path={mdiFlagVariant} size={1} /></div>;
            case "reject":
                return <div className="marker-icon reject-icon"><Icon path={mdiCloseCircleOutline} size={1} /></div>;
            case "circlePlus":
                return <div className="marker-icon circle-plus-icon"><Icon path={mdiPlusCircle} size={1} /></div>;
            case "circleMinus":
                return <div className="marker-icon circle-minus-icon"><Icon path={mdiMinusCircle} size={1} /></div>;
            case "p":
                return <div className="marker-icon p-icon"><BravuraMarkerIcon glyph="p" /></div>;
            case "mp":
                return <div className="marker-icon mp-icon"><BravuraMarkerIcon glyph="mp" /></div>;
            case "mf":
                return <div className="marker-icon mf-icon"><BravuraMarkerIcon glyph="mf" /></div>;
            case "f":
                return <div className="marker-icon f-icon"><BravuraMarkerIcon glyph="f" /></div>;
            case "fermata":
                return <div className="marker-icon fermata-icon"><BravuraMarkerIcon glyph="fermata" /></div>;
            case "cresc":
                return <div className="marker-icon cresc-icon"><HairpinMarkerIcon direction="cresc" /></div>;
            case "decresc":
                return <div className="marker-icon decresc-icon"><HairpinMarkerIcon direction="decresc" /></div>;
            case "fire":
                return <div className="marker-icon fire-icon"><Icon path={mdiFire} size={1} /></div>;
            case "lightning":
                return <div className="marker-icon lightning-icon"><Icon path={mdiLightningBolt} size={1} /></div>;
            case "blank":
                return <div className="marker-icon blank-icon"></div>;
            // case "asterisk":
            //     return <div className="marker-icon asterisk-icon"><Icon path={mdiAsterisk} size={1} /></div>;
            // case "up":
            //     return <div className="marker-icon up-icon"><Icon path={mdiArrowUp} size={1} /></div>;
            case "circle1":
                return <div className="marker-icon circle1-icon"><Icon path={mdiAlphaACircle} size={1} /></div>;
            case "circle2":
                return <div className="marker-icon circle2-icon"><Icon path={mdiAlphaBCircle} size={1} /></div>;
            case "circle3":
                return <div className="marker-icon circle3-icon"><Icon path={mdiAlphaCCircle} size={1} /></div>;
            case "circle4":
                return <div className="marker-icon circle4-icon"><Icon path={mdiAlphaDCircle} size={1} /></div>;
            case "heart":
                return <div className="marker-icon heart-icon"><Icon path={mdiHeart} size={1} /></div>;
            // case "diamond":
            //     return <div className="marker-icon diamond-icon"><Icon path={mdiCardsDiamond} size={1} /></div>;
            // case "club":
            //     return <div className="marker-icon club-icon"><Icon path={mdiCardsClub} size={1} /></div>;
            // case "spade":
            //     return <div className="marker-icon spade-icon"><Icon path={mdiCardsSpade} size={1} /></div>;
            case "trash":
                return <div className="marker-icon trash-icon"><Icon path={mdiTrashCanOutline} size={1} /></div>;
        }
    })();

    return (<div className={`song-order-marker ${className || ""}`} style={style}>
        {innerContent}
    </div>);
};


interface SongOrderMarkerControlProps {
    value: SongOrderMarkerVariant;
    onChange?: (newValue: SongOrderMarkerVariant) => void;
    className?: string;
    style?: React.CSSProperties;
};

export const SongOrderMarkerControl = React.forwardRef<HTMLButtonElement, SongOrderMarkerControlProps>(
    (props, ref) => {
        const { value, onChange, className, style } = props;

        return (
            <DesktopMenu.Root>
                <DesktopMenu.Trigger
                    ref={ref}
                    className={`song-order-marker-control ${className || ""}`}
                    style={style}
                    caret={false}
                >
                    <SongOrderMarkerValue value={value} />
                </DesktopMenu.Trigger>
                <DesktopMenu.Content>
                    {SongOrderMarkerVariantValues.map((variant) => (
                        <DesktopMenu.Item
                            key={variant}
                            checked={value === variant}
                            onSelect={() => {
                                if (onChange) {
                                    onChange(variant);
                                }
                            }}
                        >
                            <SongOrderMarkerValue value={variant} />
                        </DesktopMenu.Item>
                    ))}
                </DesktopMenu.Content>
            </DesktopMenu.Root>
        );
    },
);

SongOrderMarkerControl.displayName = "SongOrderMarkerControl";
