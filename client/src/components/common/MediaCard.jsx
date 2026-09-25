export default function MediaCard({ art, title, children, className = '', onClick }) {
  const content = <><div className="media-art-wrap"><img className="media-art" src={art} alt="" loading="lazy" /></div><div className="media-info"><strong title={title}>{title}</strong>{children}</div></>
  return onClick ? <button type="button" className={`media-card ${className}`} onClick={onClick}>{content}</button> : <div className={`media-card ${className}`}>{content}</div>
}
