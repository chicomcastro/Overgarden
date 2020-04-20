using UnityEngine;
using UnityEngine.UI;

public class ScoreScript : DataHolder
{
    public Text points;

    private void Update()
    { 
        points.text = DataHolder.instance.GetScore().ToString(); 
    }
}
