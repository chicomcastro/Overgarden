using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

public class SeedDisplay : MonoBehaviour
{
    public Seed seed;
    public Text nameText;
    public Text descriptionText;
    public Image artworkImage;
    public Text pointsText;
    public Text growthTimeText;
    public Text deathTimeText;
        void Start()
    {
        nameText.text = seed.itemName;
        descriptionText.text = seed.description;
        artworkImage.sprite = seed.artwork;
        pointsText.text = seed.points.ToString();
        growthTimeText.text = seed.growthTime.ToString();
        deathTimeText.text = seed.deathTime.ToString();
    }

  
}
